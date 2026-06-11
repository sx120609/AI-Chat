import { spawn } from "child_process";
import { createHash } from "crypto";
import { access, copyFile, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "fs/promises";
import os from "os";
import path from "path";

export type CodeInterpreterRuntimeSettings = {
  codeInterpreterEnabled: boolean;
  codeInterpreterSandbox: string;
  codeInterpreterAllowPackageInstall: boolean;
  codeInterpreterPipIndexUrl: string;
};

export type SandboxInputFile = {
  content?: string;
  name: string;
  sourcePath?: string;
};

export type SandboxRunOptions = {
  code: string;
  files?: SandboxInputFile[];
  packages?: string[];
  settings: CodeInterpreterRuntimeSettings;
};

export type SandboxRunResult = {
  command: string;
  durationMs: number;
  exitCode: number | null;
  outputFiles: Array<{ name: string; sizeBytes: number }>;
  stderr: string;
  stdout: string;
  timedOut: boolean;
};

const DEFAULT_DOCKER_IMAGE = process.env.CODE_INTERPRETER_DOCKER_IMAGE || "python:3.12-slim";
const MAX_OUTPUT_CHARS = 30_000;
const SANDBOX_TIMEOUT_MS = Number(process.env.CODE_INTERPRETER_TIMEOUT_MS || 45_000);
const PACKAGE_INSTALL_TIMEOUT_MS = Number(
  process.env.CODE_INTERPRETER_PACKAGE_INSTALL_TIMEOUT_MS || 120_000
);
const PACKAGE_CACHE_ENABLED = process.env.CODE_INTERPRETER_PACKAGE_CACHE !== "false";
const PACKAGE_CACHE_WAIT_MS = Number(process.env.CODE_INTERPRETER_PACKAGE_CACHE_WAIT_MS || 120_000);
const CACHE_ROOT =
  process.env.CODE_INTERPRETER_CACHE_DIR || path.join(process.cwd(), ".cache", "code-interpreter");
const PIP_CACHE_DIR = path.join(CACHE_ROOT, "pip");
const PACKAGE_CACHE_DIR = path.join(CACHE_ROOT, "packages");

function safeFileName(name: string) {
  const base = path.basename(name).replace(/[^\w.\-()\u4e00-\u9fff ]+/g, "_").slice(0, 160);

  return base || "attachment";
}

function normalizePackageName(value: string) {
  const trimmed = value.trim();

  if (!trimmed || trimmed.startsWith("-") || trimmed.includes("/") || trimmed.includes("\\")) {
    return "";
  }

  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}(?:==[A-Za-z0-9_.!*+~-]{1,80})?$/.test(trimmed)) {
    return "";
  }

  return trimmed;
}

function truncateOutput(value: string) {
  if (value.length <= MAX_OUTPUT_CHARS) {
    return value;
  }

  return `${value.slice(0, MAX_OUTPUT_CHARS)}\n\n[输出过长，已截断]`;
}

function dockerVolumePath(value: string) {
  return value.replaceAll("\\", "/");
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function pathExists(value: string) {
  try {
    await access(value);
    return true;
  } catch {
    return false;
  }
}

function packageCacheKey(packages: string[], settings: CodeInterpreterRuntimeSettings) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        image: DEFAULT_DOCKER_IMAGE,
        indexUrl: settings.codeInterpreterPipIndexUrl,
        packages: [...packages].sort()
      })
    )
    .digest("hex")
    .slice(0, 20);
}

function runProcess(command: string, args: string[], timeoutMs: number) {
  return new Promise<{
    durationMs: number;
    exitCode: number | null;
    stderr: string;
    stdout: string;
    timedOut: boolean;
  }>((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      stdout = truncateOutput(stdout);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      stderr = truncateOutput(stderr);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve({
        durationMs: Date.now() - startedAt,
        exitCode,
        stderr,
        stdout,
        timedOut
      });
    });
  });
}

async function listOutputFiles(directory: string) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files: Array<{ name: string; sizeBytes: number }> = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const fullPath = path.join(directory, entry.name);
    const fileStat = await stat(fullPath).catch(() => null);

    if (fileStat) {
      files.push({ name: entry.name, sizeBytes: fileStat.size });
    }
  }

  return files;
}

async function waitForPackageCache(markerPath: string) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < PACKAGE_CACHE_WAIT_MS) {
    if (await pathExists(markerPath)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error("等待 Python 包缓存准备超时。");
}

async function preparePackageCache(
  packages: string[],
  settings: CodeInterpreterRuntimeSettings
) {
  if (packages.length === 0 || !PACKAGE_CACHE_ENABLED) {
    return null;
  }

  const sortedPackages = [...packages].sort();
  const cacheKey = packageCacheKey(sortedPackages, settings);
  const packageDirectory = path.join(PACKAGE_CACHE_DIR, cacheKey);
  const markerPath = path.join(packageDirectory, ".ready");
  const lockDirectory = `${packageDirectory}.lock`;

  if (await pathExists(markerPath)) {
    return packageDirectory;
  }

  await mkdir(PIP_CACHE_DIR, { recursive: true });
  await mkdir(PACKAGE_CACHE_DIR, { recursive: true });

  let ownsLock = false;

  try {
    await mkdir(lockDirectory);
    ownsLock = true;
  } catch {
    await waitForPackageCache(markerPath);
    return packageDirectory;
  }

  try {
    if (await pathExists(markerPath)) {
      return packageDirectory;
    }

    await rm(packageDirectory, { force: true, recursive: true }).catch(() => undefined);
    await mkdir(packageDirectory, { recursive: true });

    const requirementsRoot = path.join(os.tmpdir(), "team-ai-gateway-pip-");
    await mkdir(requirementsRoot, { recursive: true });
    const requirementsDirectory = await mkdtemp(path.join(requirementsRoot, "requirements-"));

    try {
      await writeFile(
        path.join(requirementsDirectory, "requirements.txt"),
        sortedPackages.join("\n"),
        "utf8"
      );

      const args = [
        "run",
        "--rm",
        "--network",
        "bridge",
        "--memory",
        process.env.CODE_INTERPRETER_DOCKER_MEMORY || "768m",
        "--cpus",
        process.env.CODE_INTERPRETER_DOCKER_CPUS || "1",
        "-v",
        `${dockerVolumePath(packageDirectory)}:/deps`,
        "-v",
        `${dockerVolumePath(PIP_CACHE_DIR)}:/pip-cache`,
        "-v",
        `${dockerVolumePath(requirementsDirectory)}:/requirements:ro`,
        DEFAULT_DOCKER_IMAGE,
        "sh",
        "-lc",
        [
          "python -m pip install --disable-pip-version-check --no-input",
          "--cache-dir /pip-cache",
          `--index-url ${shellQuote(settings.codeInterpreterPipIndexUrl)}`,
          "--target /deps -r /requirements/requirements.txt"
        ].join(" ")
      ];
      const result = await runProcess("docker", args, PACKAGE_INSTALL_TIMEOUT_MS);

      if (result.timedOut || result.exitCode !== 0) {
        throw new Error(
          [
            `Python 包缓存安装失败，退出码 ${result.exitCode}${result.timedOut ? "（超时）" : ""}。`,
            result.stdout ? `stdout:\n${result.stdout}` : "",
            result.stderr ? `stderr:\n${result.stderr}` : ""
          ]
            .filter(Boolean)
            .join("\n\n")
        );
      }

      await writeFile(
        markerPath,
        JSON.stringify({
          image: DEFAULT_DOCKER_IMAGE,
          indexUrl: settings.codeInterpreterPipIndexUrl,
          packages: sortedPackages,
          readyAt: new Date().toISOString()
        }),
        "utf8"
      );
    } catch (error) {
      await rm(packageDirectory, { force: true, recursive: true }).catch(() => undefined);
      throw error;
    } finally {
      await rm(requirementsDirectory, { force: true, recursive: true }).catch(() => undefined);
    }

    return packageDirectory;
  } finally {
    if (ownsLock) {
      await rm(lockDirectory, { force: true, recursive: true }).catch(() => undefined);
    }
  }
}

export async function runPythonInSandbox(options: SandboxRunOptions): Promise<SandboxRunResult> {
  const { settings } = options;

  if (!settings.codeInterpreterEnabled) {
    throw new Error("代码解释器未启用。");
  }

  if (settings.codeInterpreterSandbox !== "docker") {
    throw new Error("代码解释器当前只允许 Docker 沙箱。");
  }

  const packages = [...new Set((options.packages ?? []).map(normalizePackageName).filter(Boolean))];

  if (packages.length > 0 && !settings.codeInterpreterAllowPackageInstall) {
    throw new Error("管理员未允许沙箱内安装 Python 包。");
  }

  const runDirectory = path.join(os.tmpdir(), "team-ai-gateway-run-");
  await mkdir(runDirectory, { recursive: true });
  const workDirectory = await mkdtemp(path.join(runDirectory, "job-"));
  const inputDirectory = path.join(workDirectory, "inputs");
  const outputDirectory = path.join(workDirectory, "outputs");

  await mkdir(inputDirectory, { recursive: true });
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(workDirectory, "analysis.py"), options.code, "utf8");

  for (const file of options.files ?? []) {
    const target = path.join(inputDirectory, safeFileName(file.name));

    if (file.content !== undefined) {
      await writeFile(target, file.content, "utf8");
    } else if (file.sourcePath) {
      await copyFile(file.sourcePath, target);
    }
  }

  const packageCacheDirectory = await preparePackageCache(packages, settings);
  const installPackagesInWorkspace = packages.length > 0 && !packageCacheDirectory;

  if (installPackagesInWorkspace) {
    await writeFile(path.join(workDirectory, "requirements.txt"), packages.join("\n"), "utf8");
  }

  const volume = `${dockerVolumePath(workDirectory)}:/workspace`;
  const network = installPackagesInWorkspace ? "bridge" : "none";
  const args = [
    "run",
    "--rm",
    "--network",
    network,
    "--memory",
    process.env.CODE_INTERPRETER_DOCKER_MEMORY || "768m",
    "--cpus",
    process.env.CODE_INTERPRETER_DOCKER_CPUS || "1",
    "-v",
    volume,
    ...(packageCacheDirectory
      ? ["-v", `${dockerVolumePath(packageCacheDirectory)}:/deps:ro`]
      : []),
    "-w",
    "/workspace",
    DEFAULT_DOCKER_IMAGE
  ];
  const runScript =
    packageCacheDirectory
      ? ["sh", "-lc", "PYTHONPATH=/deps python /workspace/analysis.py"]
      : installPackagesInWorkspace
      ? [
          "sh",
          "-lc",
          [
            "python -m pip install --disable-pip-version-check --no-input",
            `--index-url ${shellQuote(settings.codeInterpreterPipIndexUrl)}`,
            "--target /workspace/.deps -r /workspace/requirements.txt",
            "&& PYTHONPATH=/workspace/.deps python /workspace/analysis.py"
          ].join(" ")
        ]
      : ["python", "/workspace/analysis.py"];
  const result = await runProcess("docker", [...args, ...runScript], SANDBOX_TIMEOUT_MS);
  const outputFiles = await listOutputFiles(outputDirectory);

  await rm(workDirectory, { force: true, recursive: true }).catch(() => undefined);

  return {
    command: `docker ${[...args, ...runScript].join(" ")}`,
    outputFiles,
    ...result
  };
}
