import { attachmentAbsolutePath } from "@/lib/attachments";
import {
  runPythonInSandbox,
  type CodeInterpreterRuntimeSettings,
  type SandboxInputFile
} from "@/lib/code-interpreter";
import {
  createChatCompletionText,
  type AiRuntimeSettings,
  type UpstreamChatMessage
} from "@/lib/upstream";

type AttachmentForAnalysis = {
  id: string;
  kind: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  extractedText: string | null;
};

type PlannerResponse = {
  code?: unknown;
  packages?: unknown;
  plan?: unknown;
};

const MAX_TOOL_REPORT_CHARS = 16_000;
const MAX_PLANNER_RESPONSE_CHARS = 24_000;

function shouldAnalyzeWithCode(attachments: AttachmentForAnalysis[]) {
  return attachments.some((attachment) => attachment.kind !== "IMAGE");
}

function jsonFromPlannerResponse(text: string): PlannerResponse | null {
  const trimmed = text.trim().slice(0, MAX_PLANNER_RESPONSE_CHARS);
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || trimmed;

  try {
    return JSON.parse(candidate) as PlannerResponse;
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");

    if (start < 0 || end <= start) {
      return null;
    }

    try {
      return JSON.parse(candidate.slice(start, end + 1)) as PlannerResponse;
    } catch {
      return null;
    }
  }
}

function textFileName(index: number, attachment: AttachmentForAnalysis) {
  return `extracted-${index + 1}-${attachment.originalName}.txt`;
}

function buildSandboxFiles(attachments: AttachmentForAnalysis[]): SandboxInputFile[] {
  return attachments.flatMap((attachment, index) => {
    const files: SandboxInputFile[] = [
      {
        name: `${index + 1}-${attachment.originalName}`,
        sourcePath: attachmentAbsolutePath(attachment)
      }
    ];

    if (attachment.extractedText?.trim()) {
      files.push({
        content: attachment.extractedText,
        name: textFileName(index, attachment)
      });
    }

    return files;
  });
}

function buildPlannerMessages(options: {
  attachments: AttachmentForAnalysis[];
  allowPackageInstall: boolean;
  prompt: string;
}): UpstreamChatMessage[] {
  const files = options.attachments
    .map((attachment, index) => {
      const extracted = attachment.extractedText?.trim()
        ? `同时提供 ${textFileName(index, attachment)}，里面是后端已提取文本。`
        : "没有可用的已提取文本。";

      return `${index + 1}. ${attachment.originalName} (${attachment.mimeType}, ${attachment.sizeBytes} bytes). ${extracted}`;
    })
    .join("\n");

  return [
    {
      role: "system",
      content:
        "你是文件分析代码规划器。你不会回答用户问题，只生成可在受限 Python 沙箱中运行的代码。只返回 JSON，不要 Markdown，不要解释隐藏推理。JSON 结构必须是 {\"plan\":\"一句话计划\",\"packages\":[\"可选包名\"],\"code\":\"Python 代码\"}。代码只能读取 /workspace/inputs，输出写入 /workspace/outputs，可打印简短分析结果。不要访问环境变量、密钥、网络、本机路径或 /workspace 以外路径。遇到 ZIP 压缩包时，优先使用 Python 标准库 zipfile 在沙箱内列目录、读取文本或解压到 /workspace/outputs。"
    },
    {
      role: "user",
      content: `用户请求：${options.prompt}\n\n可用文件：\n${files}\n\n${
        options.allowPackageInstall
          ? "如确有必要，可在 packages 中声明 PyPI 包名；优先使用标准库和已提取文本。"
          : "管理员未允许安装额外包，请只使用 Python 标准库和已提取文本。"
      }`
    }
  ];
}

function truncateReport(value: string) {
  if (value.length <= MAX_TOOL_REPORT_CHARS) {
    return value;
  }

  return `${value.slice(0, MAX_TOOL_REPORT_CHARS)}\n\n[工具结果过长，已截断]`;
}

export async function maybeRunFileAnalysisAgent(options: {
  attachments: AttachmentForAnalysis[];
  modelId: string;
  prompt: string;
  settings: CodeInterpreterRuntimeSettings & AiRuntimeSettings;
}) {
  const { attachments, settings } = options;

  if (!settings.codeInterpreterEnabled || settings.mockResponses || !shouldAnalyzeWithCode(attachments)) {
    return "";
  }

  try {
    const plannerText = await createChatCompletionText(
      options.modelId,
      buildPlannerMessages({
        allowPackageInstall: settings.codeInterpreterAllowPackageInstall,
        attachments,
        prompt: options.prompt
      }),
      settings
    );
    const plan = jsonFromPlannerResponse(plannerText);
    const code = typeof plan?.code === "string" ? plan.code.trim() : "";
    const packages = Array.isArray(plan?.packages)
      ? plan.packages.filter((item): item is string => typeof item === "string")
      : [];

    if (!code) {
      return "";
    }

    const result = await runPythonInSandbox({
      code,
      files: buildSandboxFiles(attachments),
      packages,
      settings
    });

    return truncateReport(
      [
        "文件分析工具结果：",
        `计划：${typeof plan?.plan === "string" ? plan.plan : "自动分析上传附件"}`,
        `退出码：${result.exitCode}${result.timedOut ? "（超时）" : ""}`,
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : "",
        result.outputFiles.length
          ? `输出文件：${result.outputFiles
              .map((file) => `${file.name} (${file.sizeBytes} bytes)`)
              .join(", ")}`
          : ""
      ]
        .filter(Boolean)
        .join("\n\n")
    );
  } catch (error) {
    return truncateReport(
      `文件分析工具未执行成功：${error instanceof Error ? error.message : String(error)}`
    );
  }
}
