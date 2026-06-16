import { useState, useMemo, FormEvent } from "react";
import {
  KeyRound,
  BookOpen,
  Plus,
  Loader2,
  Copy,
  Shield,
  Trash2,
  X,
  Download,
  Terminal
} from "lucide-react";
import type { ChatModelView, SiteSettingsView, UserApiKeyView } from "@/types/gateway";
import { apiGuideTools, apiGuideOsOptions } from "./components";
import type { ApiGuideTool, ApiGuideOs } from "./types";

const LOWIQ_API_KEY_ENV = "LOWIQ_API_KEY";
const CODEX_MODEL_CATALOG_PATH_PLACEHOLDER = "__LOWIQ_CODEX_MODEL_CATALOG_JSON__";

type ApiTabProps = {
  origin: string;
  apiModels: ChatModelView[];
  siteSettings: SiteSettingsView;
  canCreateApiKey: boolean;
  apiKeyName: string;
  setApiKeyName: (name: string) => void;
  onCreateApiKey: (event: FormEvent<HTMLFormElement>) => void;
  loadingKeys: boolean;
  apiKeys: UserApiKeyView[];
  onUpdateApiKey: (
    key: UserApiKeyView,
    patch: Partial<Pick<UserApiKeyView, "active" | "name">>
  ) => void;
  onCopyApiKey: (key: UserApiKeyView) => void;
  onSetDeleteKeyId: (id: string | null) => void;
  savingKeyId: string | null;
  creatingKey: boolean;
  apiGuideOpen: boolean;
  setApiGuideOpen: (open: boolean) => void;
  selectedGuideApiKey: UserApiKeyView | null;
  onOpenApiGuide: (key?: UserApiKeyView) => void;
  onCopyText: (text: string, message?: string) => void;
  onDownloadTextFile: (fileName: string, content: string) => void;
};

function jsonConfig(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function encodeBase64(text: string) {
  if (typeof window === "undefined") {
    return "";
  }
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary);
}

function shellSingleQuote(value: string) {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

function powerShellDoubleQuote(value: string) {
  return `"${value.replace(/`/g, "``").replace(/"/g, '`"')}"`;
}

function buildCodexConfig({
  baseUrl,
  envKey = LOWIQ_API_KEY_ENV,
  modelCatalogPath,
  model,
  siteName
}: {
  baseUrl: string;
  envKey?: string;
  modelCatalogPath: string;
  model: string;
  siteName: string;
}) {
  return [
    'model_provider = "lowiq"',
    `model = "${model}"`,
    `review_model = "${model}"`,
    `model_catalog_json = "${modelCatalogPath}"`,
    'model_reasoning_effort = "high"',
    'disable_response_storage = true',
    'network_access = "enabled"',
    'windows_wsl_setup_acknowledged = true',
    "",
    "[model_providers.lowiq]",
    `name = "${siteName || "AI Gateway"}"`,
    `base_url = "${baseUrl}"`,
    'wire_api = "responses"',
    `env_key = "${envKey}"`,
    `env_key_instructions = "Set ${envKey} to your ${siteName || "AI Gateway"} API key"`,
    "",
    "[features]",
    "goals = true"
  ].join("\n");
}

function buildCodexModelCatalog(models: ChatModelView[]) {
  return jsonConfig({
    models: models.map((model, index) => ({
      slug: model.id,
      display_name: model.label || model.id,
      description:
        model.contextNote === "上游原生" || model.source === "upstream"
          ? `${model.upstreamId} from this gateway`
          : `${model.contextNote || "Chat model"} via ${model.upstreamId}`,
      default_reasoning_level: model.supportsReasoning ? "medium" : null,
      supported_reasoning_levels: model.supportsReasoning
        ? [
            {
              effort: "low",
              description: "Fast responses with lighter reasoning"
            },
            {
              effort: "medium",
              description: "Balanced speed and reasoning depth"
            },
            {
              effort: "high",
              description: "Deeper reasoning for complex tasks"
            },
            {
              effort: "xhigh",
              description: "Extra high reasoning depth"
            }
          ]
        : [],
      shell_type: "shell_command",
      visibility: "list",
      supported_in_api: true,
      priority: index,
      additional_speed_tiers: [],
      service_tiers: [],
      availability_nux: null,
      upgrade: null,
      base_instructions:
        "You are Codex, a coding agent. Follow the user's request, inspect the workspace before editing, and use tools carefully.",
      model_messages: null,
      supports_reasoning_summaries: true,
      default_reasoning_summary: "none",
      support_verbosity: true,
      default_verbosity: "low",
      apply_patch_tool_type: "freeform",
      web_search_tool_type: "text_and_image",
      truncation_policy: {
        mode: "tokens",
        limit: 10000
      },
      supports_parallel_tool_calls: true,
      supports_image_detail_original: true,
      context_window: model.contextWindowTokens,
      max_context_window: model.maxContextWindowTokens || model.contextWindowTokens,
      effective_context_window_percent: 95,
      experimental_supported_tools: [],
      input_modalities: ["text", "image"],
      supports_search_tool: false
    }))
  });
}

function buildCodexInstallCommand({
  apiKey,
  catalog,
  config,
  os
}: {
  apiKey: string;
  catalog: string;
  config: string;
  os: ApiGuideOs;
}) {
  const encodedConfig = encodeBase64(config);
  const encodedCatalog = encodeBase64(catalog);

  if (!encodedConfig || !encodedCatalog) {
    return "";
  }

  if (os === "windows") {
    return [
      '$codexDir = Join-Path $env:USERPROFILE ".codex"',
      '$catalogDir = Join-Path $codexDir "model-catalogs"',
      '$catalogPath = Join-Path $catalogDir "lowiq.json"',
      "New-Item -ItemType Directory -Force -Path $catalogDir | Out-Null",
      `$config = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("${encodedConfig}")).Replace("${CODEX_MODEL_CATALOG_PATH_PLACEHOLDER}", ($catalogPath -replace "\\\\", "/"))`,
      '$utf8 = [Text.UTF8Encoding]::new($false)',
      '[IO.File]::WriteAllText((Join-Path $codexDir "config.toml"), $config, $utf8)',
      `[IO.File]::WriteAllText($catalogPath, [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("${encodedCatalog}")), $utf8)`,
      `[Environment]::SetEnvironmentVariable(${powerShellDoubleQuote(LOWIQ_API_KEY_ENV)}, ${powerShellDoubleQuote(apiKey)}, "User")`,
      `$env:${LOWIQ_API_KEY_ENV} = ${powerShellDoubleQuote(apiKey)}`
    ].join("; ");
  }

  return [
    "python3 - <<'PY'",
    "import base64, os, pathlib",
    `config = base64.b64decode(${JSON.stringify(encodedConfig)}).decode()`,
    `catalog = base64.b64decode(${JSON.stringify(encodedCatalog)}).decode()`,
    'home = pathlib.Path.home() / ".codex"',
    'catalog_dir = home / "model-catalogs"',
    'catalog_path = catalog_dir / "lowiq.json"',
    "catalog_dir.mkdir(parents=True, exist_ok=True)",
    `config = config.replace(${JSON.stringify(CODEX_MODEL_CATALOG_PATH_PLACEHOLDER)}, str(catalog_path))`,
    '(home / "config.toml").write_text(config, encoding="utf-8")',
    'catalog_path.write_text(catalog, encoding="utf-8")',
    "PY",
    `export ${LOWIQ_API_KEY_ENV}=${shellSingleQuote(apiKey)}`
  ].join("\n");
}

function buildCodexEnvSetup({
  apiKey,
  envKey = LOWIQ_API_KEY_ENV,
  os
}: {
  apiKey: string;
  envKey?: string;
  os: ApiGuideOs;
}) {
  if (os === "windows") {
    return [
      `[Environment]::SetEnvironmentVariable(${powerShellDoubleQuote(envKey)}, ${powerShellDoubleQuote(apiKey)}, "User")`,
      `$env:${envKey} = ${powerShellDoubleQuote(apiKey)}`
    ].join("\n");
  }

  return `export ${envKey}=${shellSingleQuote(apiKey)}`;
}

function buildOpenCodeConfig({
  baseUrl,
  models,
  siteName
}: {
  baseUrl: string;
  models: ChatModelView[];
  siteName: string;
}) {
  const modelEntries = Object.fromEntries(
    models.map((model) => [
      model.id,
      {
        name: model.label || model.id
      }
    ])
  );
  const primaryModel = models[0]?.id || "gpt-5.5";

  return jsonConfig({
    $schema: "https://opencode.ai/config.json",
    model: `lowiq/${primaryModel}`,
    provider: {
      lowiq: {
        npm: "@ai-sdk/openai-compatible",
        name: siteName || "AI Gateway",
        options: {
          baseURL: baseUrl
        },
        models: modelEntries
      }
    }
  });
}

function buildOpenCodeAuth(apiKey: string) {
  return jsonConfig({
    lowiq: {
      type: "api",
      key: apiKey
    }
  });
}

function buildOpenCodeImportCommand({
  auth,
  config,
  os
}: {
  auth: string;
  config: string;
  os: ApiGuideOs;
}) {
  const encodedAuth = encodeBase64(auth);
  const encodedConfig = encodeBase64(config);

  if (!encodedAuth || !encodedConfig) {
    return "";
  }

  if (os === "windows") {
    return [
      '$projectConfig = Join-Path (Get-Location) "opencode.json"',
      '$authDir = Join-Path $env:LOCALAPPDATA "opencode"',
      '$authPath = Join-Path $authDir "auth.json"',
      "New-Item -ItemType Directory -Force -Path $authDir | Out-Null",
      '$utf8 = [Text.UTF8Encoding]::new($false)',
      `[IO.File]::WriteAllText($projectConfig, [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("${encodedConfig}")), $utf8)`,
      `[IO.File]::WriteAllText($authPath, [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("${encodedAuth}")), $utf8)`,
      'Write-Host "OpenCode config written to $projectConfig"',
      'Write-Host "OpenCode auth written to $authPath"'
    ].join("; ");
  }

  return [
    "python3 - <<'PY'",
    "import base64, pathlib",
    `config = base64.b64decode(${JSON.stringify(encodedConfig)}).decode()`,
    `auth = base64.b64decode(${JSON.stringify(encodedAuth)}).decode()`,
    'project_config = pathlib.Path.cwd() / "opencode.json"',
    'auth_path = pathlib.Path.home() / ".local/share/opencode/auth.json"',
    "auth_path.parent.mkdir(parents=True, exist_ok=True)",
    'project_config.write_text(config, encoding="utf-8")',
    'auth_path.write_text(auth, encoding="utf-8")',
    'print(f"Wrote {project_config}")',
    'print(f"Wrote {auth_path}")',
    "PY"
  ].join("\n");
}

function buildClaudeRouterConfig({
  apiKey,
  baseUrl,
  models,
  siteName
}: {
  apiKey: string;
  baseUrl: string;
  models: ChatModelView[];
  siteName: string;
}) {
  const modelIds = models.map((model) => model.id);
  const primaryModel = modelIds[0] || "gpt-5.5";
  const smallModel =
    models.find((model) => /mini|flash|lite|small/i.test(`${model.id} ${model.label}`))?.id ||
    primaryModel;
  const longContextModel =
    [...models].sort((left, right) => right.contextWindowTokens - left.contextWindowTokens)[0]?.id ||
    primaryModel;

  return jsonConfig({
    LOG: true,
    API_TIMEOUT_MS: 600000,
    Providers: [
      {
        name: "lowiq",
        api_base_url: `${baseUrl}/chat/completions`,
        api_key: apiKey,
        models: modelIds.length ? modelIds : [primaryModel]
      }
    ],
    Router: {
      default: `lowiq,${primaryModel}`,
      background: `lowiq,${smallModel}`,
      think: `lowiq,${primaryModel}`,
      longContext: `lowiq,${longContextModel}`,
      longContextThreshold: 60000
    },
    comment: `${siteName || "AI Gateway"} personal API`
  });
}

function buildClaudeRouterImportCommand({
  config,
  os
}: {
  config: string;
  os: ApiGuideOs;
}) {
  const encoded = encodeBase64(config);

  if (!encoded) {
    return "";
  }

  if (os === "windows") {
    return [
      '$dir = Join-Path $env:USERPROFILE ".claude-code-router"',
      "New-Item -ItemType Directory -Force -Path $dir | Out-Null",
      '$utf8 = [Text.UTF8Encoding]::new($false)',
      `[IO.File]::WriteAllText((Join-Path $dir "config.json"), [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("${encoded}")), $utf8)`,
      "ccr restart"
    ].join("; ");
  }

  return [
    "mkdir -p ~/.claude-code-router && python3 - <<'PY'",
    "import base64, pathlib",
    `config = base64.b64decode("${encoded}").decode("utf-8")`,
    'path = pathlib.Path.home() / ".claude-code-router" / "config.json"',
    "path.write_text(config, encoding='utf-8')",
    "print(f'Wrote {path}')",
    "PY",
    "ccr restart || true"
  ].join("\n");
}

function buildClaudeRouterSetupCommand({
  config,
  os
}: {
  config: string;
  os: ApiGuideOs;
}) {
  const importCommand = buildClaudeRouterImportCommand({ config, os });

  if (!importCommand) {
    return "";
  }

  if (os === "windows") {
    return ["npm install -g @musistudio/claude-code-router", importCommand, "ccr code"].join("; ");
  }

  return ["npm install -g @musistudio/claude-code-router", importCommand, "ccr code"].join("\n");
}

function ApiCodeBlock({
  label,
  onCopy,
  value
}: {
  label: string;
  onCopy: (value: string) => void | Promise<void>;
  value: string;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950 text-slate-100 shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-slate-900 px-3 py-2">
        <span className="min-w-0 truncate font-mono text-xs text-slate-300">{label}</span>
        <button
          className="app-action-button inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/10 px-2.5 text-xs font-semibold text-slate-100 transition hover:bg-white/15"
          onClick={() => void onCopy(value)}
          type="button"
        >
          <Copy className="size-3.5" />
          复制
        </button>
      </div>
      <pre className="max-h-[22rem] overflow-auto p-4 text-xs leading-5">
        <code>{value}</code>
      </pre>
    </div>
  );
}

function ApiGuideDialog({
  apiKey,
  models,
  onClose,
  onCopy,
  onDownload,
  open,
  origin,
  siteName
}: {
  apiKey?: string | null;
  models: ChatModelView[];
  onClose: () => void;
  onCopy: (value: string, message?: string) => void | Promise<void>;
  onDownload: (fileName: string, content: string) => void;
  open: boolean;
  origin: string;
  siteName: string;
}) {
  const [tool, setTool] = useState<ApiGuideTool>("codex");
  const [os, setOs] = useState<ApiGuideOs>("unix");
  const baseUrl = origin ? `${origin}/v1` : "/v1";
  const hasApiKey = Boolean(apiKey);
  const keyValue = apiKey || "sk-user-在这里替换成你的 API Key";
  const primaryModel = models[0]?.id || "gpt-5.5";
  const codexCatalogPath =
    os === "windows"
      ? `${CODEX_MODEL_CATALOG_PATH_PLACEHOLDER}`
      : CODEX_MODEL_CATALOG_PATH_PLACEHOLDER;
  const codexModelCatalog = useMemo(() => buildCodexModelCatalog(models), [models]);
  const codexConfig = useMemo(
    () =>
      buildCodexConfig({
        baseUrl,
        model: primaryModel,
        modelCatalogPath: codexCatalogPath,
        siteName
      }),
    [baseUrl, codexCatalogPath, primaryModel, siteName]
  );
  const codexEnvSetup = useMemo(
    () => buildCodexEnvSetup({ apiKey: keyValue, os }),
    [keyValue, os]
  );
  const codexInstallCommand = useMemo(
    () =>
      buildCodexInstallCommand({
        apiKey: keyValue,
        catalog: codexModelCatalog,
        config: codexConfig,
        os
      }),
    [codexConfig, codexModelCatalog, keyValue, os]
  );
  const openCodeConfig = useMemo(
    () => buildOpenCodeConfig({ baseUrl, models, siteName }),
    [baseUrl, models, siteName]
  );
  const openCodeAuth = useMemo(() => buildOpenCodeAuth(keyValue), [keyValue]);
  const openCodeImportCommand = useMemo(
    () =>
      buildOpenCodeImportCommand({
        auth: openCodeAuth,
        config: openCodeConfig,
        os
      }),
    [openCodeAuth, openCodeConfig, os]
  );
  const claudeRouterConfig = useMemo(
    () => buildClaudeRouterConfig({ apiKey: keyValue, baseUrl, models, siteName }),
    [baseUrl, keyValue, models, siteName]
  );
  const claudeRouterImportCommand = useMemo(
    () => buildClaudeRouterImportCommand({ config: claudeRouterConfig, os }),
    [claudeRouterConfig, os]
  );
  const claudeRouterSetupCommand = useMemo(
    () => buildClaudeRouterSetupCommand({ config: claudeRouterConfig, os }),
    [claudeRouterConfig, os]
  );
  const activeTool = apiGuideTools.find((item) => item.id === tool) ?? apiGuideTools[0];

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center overflow-y-auto bg-stone-950/35 px-3 py-[calc(1rem+var(--app-safe-area-top,0px))] backdrop-blur-sm sm:p-6">
      <button aria-label="关闭教程" className="absolute inset-0" onClick={onClose} type="button" />
      <section
        aria-modal="true"
        className="app-modal-panel relative flex max-h-[min(44rem,calc(100dvh-2rem))] w-full max-w-4xl flex-col overflow-hidden rounded-[1.25rem] border border-[color:var(--ios-separator)] bg-[color:var(--claude-surface)] text-stone-950 shadow-[0_26px_90px_rgba(18,42,35,0.24)] ring-1 ring-white/70"
        role="dialog"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[color:var(--ios-separator)] px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 className="text-lg font-bold leading-7">使用 API 密钥</h2>
            <p className="mt-1 text-sm ios-muted">
              选择工具后复制配置。包含明文 Key 的配置只放在自己的设备上。
            </p>
          </div>
          <button
            className="ios-icon-button app-action-button shrink-0"
            onClick={onClose}
            title="关闭"
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {!hasApiKey ? (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
              还没有可查看的 API Key。先创建一个新 Key，或使用一次旧 Key 后再回来复制可直接执行的命令。
            </div>
          ) : null}

          <div className="flex flex-col gap-1 rounded-2xl border border-[color:var(--ios-separator)] bg-white/45 p-1 sm:flex-row">
            {apiGuideTools.map((item) => {
              const Icon = item.icon;
              const selected = item.id === tool;

              return (
                <button
                  className={`app-action-button inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition sm:w-1/3 ${
                    selected
                      ? "bg-[color:var(--claude-accent)] text-white shadow-sm"
                      : "text-stone-600 hover:bg-white/70 hover:text-stone-950"
                  }`}
                  key={item.id}
                  onClick={() => setTool(item.id)}
                  type="button"
                >
                  <Icon className="size-4" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-stone-600">
            <span className="rounded-full bg-white/60 px-2.5 py-1 text-xs font-semibold text-[color:var(--claude-accent)]">
              {activeTool.description}
            </span>
            <span>{activeTool.hint}</span>
          </div>

          <div className="mt-4 inline-flex w-fit rounded-2xl border border-[color:var(--ios-separator)] bg-white/45 p-1">
            {apiGuideOsOptions.map((item) => (
              <button
                className={`app-action-button h-9 rounded-xl px-3 text-sm font-semibold transition ${
                  item.id === os
                    ? "bg-white text-[color:var(--claude-accent)] shadow-sm"
                    : "text-stone-500 hover:text-stone-900"
                }`}
                key={item.id}
                onClick={() => setOs(item.id)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="mt-4 grid gap-4">
            {tool === "codex" ? (
              <>
                <div className="grid gap-3 rounded-xl border border-[color:var(--app-border)] bg-white/55 p-3 text-sm text-stone-700 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                  <div>
                    <p className="font-semibold text-stone-950">Codex 模型目录</p>
                    <p className="mt-1 ios-muted">
                      一键命令会写入配置和模型目录，让 Codex 下拉显示当前启用的个人 API 模型。
                    </p>
                  </div>
                  <button
                    className="ios-button-secondary app-action-button flex h-10 items-center justify-center gap-2 px-3 text-sm"
                    onClick={() => onDownload("lowiq-codex-models.json", codexModelCatalog)}
                    type="button"
                  >
                    <Download className="size-4" />
                    下载目录
                  </button>
                  <button
                    className="ios-button-primary app-action-button flex h-10 items-center justify-center gap-2 px-3 text-sm"
                    disabled={!hasApiKey}
                    onClick={() => void onCopy(codexInstallCommand, "Codex 一键安装命令已复制。")}
                    type="button"
                  >
                    <Terminal className="size-4" />
                    复制安装命令
                  </button>
                </div>
                <ApiCodeBlock
                  label={
                    os === "windows"
                      ? "%USERPROFILE%\\.codex\\config.toml（一键命令会替换目录路径）"
                      : "~/.codex/config.toml（一键命令会替换目录路径）"
                  }
                  onCopy={onCopy}
                  value={codexConfig}
                />
                <ApiCodeBlock
                  label={
                    os === "windows"
                      ? "%USERPROFILE%\\.codex\\model-catalogs\\lowiq.json"
                      : "~/.codex/model-catalogs/lowiq.json"
                  }
                  onCopy={onCopy}
                  value={codexModelCatalog}
                />
                {hasApiKey ? (
                  <ApiCodeBlock
                    label={os === "windows" ? "PowerShell 一键安装命令" : "Shell 一键安装命令"}
                    onCopy={(value) => onCopy(value, "Codex 一键安装命令已复制。")}
                    value={codexInstallCommand}
                  />
                ) : null}
                <ApiCodeBlock
                  label={os === "windows" ? "PowerShell 环境变量" : "Shell 环境变量"}
                  onCopy={(value) => onCopy(value, `${LOWIQ_API_KEY_ENV} 设置命令已复制。`)}
                  value={codexEnvSetup}
                />
              </>
            ) : null}

            {tool === "opencode" ? (
              <>
                <div className="grid gap-3 rounded-xl border border-[color:var(--app-border)] bg-white/55 p-3 text-sm text-stone-700 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                  <div>
                    <p className="font-semibold text-stone-950">OpenCode 项目导入</p>
                    <p className="mt-1 ios-muted">
                      在目标项目目录执行命令，会写入 <code>opencode.json</code> 和 OpenCode auth。
                    </p>
                  </div>
                  <button
                    className="ios-button-secondary app-action-button flex h-10 items-center justify-center gap-2 px-3 text-sm"
                    onClick={() => onDownload("opencode.json", openCodeConfig)}
                    type="button"
                  >
                    <Download className="size-4" />
                    下载配置
                  </button>
                  <button
                    className="ios-button-primary app-action-button flex h-10 items-center justify-center gap-2 px-3 text-sm"
                    disabled={!hasApiKey}
                    onClick={() => void onCopy(openCodeImportCommand, "OpenCode 一键导入命令已复制。")}
                    type="button"
                  >
                    <Terminal className="size-4" />
                    复制导入命令
                  </button>
                </div>
                {hasApiKey ? (
                  <ApiCodeBlock
                    label={os === "windows" ? "PowerShell 一键导入命令" : "Shell 一键导入命令"}
                    onCopy={(value) => onCopy(value, "OpenCode 一键导入命令已复制。")}
                    value={openCodeImportCommand}
                  />
                ) : null}
                <ApiCodeBlock
                  label="opencode.json"
                  onCopy={onCopy}
                  value={openCodeConfig}
                />
                <ApiCodeBlock
                  label={os === "windows" ? "%LOCALAPPDATA%\\opencode\\auth.json" : "~/.local/share/opencode/auth.json"}
                  onCopy={onCopy}
                  value={openCodeAuth}
                />
              </>
            ) : null}

            {tool === "claude-router" ? (
              <>
                <div className="grid gap-3 rounded-xl border border-[color:var(--app-border)] bg-white/55 p-3 text-sm text-stone-700 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                  <div>
                    <p className="font-semibold text-stone-950">Claude Code Router / Switch 导入</p>
                    <p className="mt-1 ios-muted">
                      安装依赖、写入配置、重启服务，然后用 <code>ccr code</code> 启动。
                    </p>
                  </div>
                  <button
                    className="ios-button-secondary app-action-button flex h-10 items-center justify-center gap-2 px-3 text-sm"
                    onClick={() => onDownload("claude-code-router-config.json", claudeRouterConfig)}
                    type="button"
                  >
                    <Download className="size-4" />
                    下载配置
                  </button>
                  <button
                    className="ios-button-primary app-action-button flex h-10 items-center justify-center gap-2 px-3 text-sm"
                    disabled={!hasApiKey}
                    onClick={() =>
                      void onCopy(claudeRouterSetupCommand, "Claude Router 一键安装命令已复制。")
                    }
                    type="button"
                  >
                    <Terminal className="size-4" />
                    复制安装命令
                  </button>
                </div>
                {hasApiKey ? (
                  <ApiCodeBlock
                    label={os === "windows" ? "PowerShell 一键安装命令" : "Shell 一键安装命令"}
                    onCopy={(value) => onCopy(value, "Claude Router 一键安装命令已复制。")}
                    value={claudeRouterSetupCommand}
                  />
                ) : null}
                <ApiCodeBlock
                  label="~/.claude-code-router/config.json"
                  onCopy={onCopy}
                  value={claudeRouterConfig}
                />
                <ApiCodeBlock
                  label={os === "windows" ? "PowerShell 一键导入命令" : "Shell 一键导入命令"}
                  onCopy={(value) => onCopy(value, "Claude Router 一键导入命令已复制。")}
                  value={claudeRouterImportCommand}
                />
                <ApiCodeBlock
                  label="启动命令"
                  onCopy={onCopy}
                  value={["npm install -g @musistudio/claude-code-router", "ccr restart", "ccr code"].join("\n")}
                />
              </>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

export function ApiTab({
  origin,
  apiModels,
  siteSettings,
  canCreateApiKey,
  apiKeyName,
  setApiKeyName,
  onCreateApiKey,
  loadingKeys,
  apiKeys,
  onUpdateApiKey,
  onCopyApiKey,
  onSetDeleteKeyId,
  savingKeyId,
  creatingKey,
  apiGuideOpen,
  setApiGuideOpen,
  selectedGuideApiKey,
  onOpenApiGuide,
  onCopyText,
  onDownloadTextFile
}: ApiTabProps) {
  return (
    <>
      <section className="ios-panel motion-lift overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-[color:var(--ios-separator)] px-4 py-3">
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-[color:var(--claude-accent)]" />
            <h2 className="text-base font-semibold">个人 API</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              className="ios-button-secondary app-action-button flex h-9 items-center gap-2 px-3 text-sm"
              onClick={() => onOpenApiGuide()}
              type="button"
            >
              <BookOpen className="size-4" />
              如何使用
            </button>
            <span className="hidden rounded-full bg-white/70 px-2.5 py-1 text-xs font-semibold text-stone-600 sm:inline-flex">
              {canCreateApiKey ? "VIP 可用" : "需 VIP"}
            </span>
          </div>
        </div>

        <div className="grid gap-4 p-4">
          <div className="grid gap-3 rounded-xl border border-[color:var(--app-border)] bg-white/50 p-3 text-sm text-stone-700 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
            <div className="min-w-0 rounded-lg bg-white/55 px-3 py-2.5">
              <p className="text-xs font-semibold uppercase text-stone-400">Base URL</p>
              <p className="mt-1 truncate font-semibold text-stone-900">
                {origin ? `${origin}/v1` : "/v1"}
              </p>
              <p className="mt-1 truncate text-xs ios-muted">
                管理前缀 {origin ? `${origin}/api/v1` : "/api/v1"}
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {[
                ["Responses", "/responses"],
                ["Chat", "/chat/completions"],
                ["Models", "/models"]
              ].map(([label, path]) => (
                <div
                  className="min-w-0 rounded-lg border border-[color:var(--ios-separator)] bg-white/60 px-3 py-2"
                  key={path}
                >
                  <p className="text-xs font-semibold text-stone-500">{label}</p>
                  <p className="mt-1 truncate font-mono text-xs text-stone-800">{path}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-[color:var(--app-border)] bg-white/55 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-stone-950">支持的模型</h3>
              <span className="rounded-full bg-white/70 px-2 py-1 text-xs font-semibold ios-muted">
                {apiModels.length} 个
              </span>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {apiModels.map((model) => (
                <div
                  className="rounded-lg border border-[color:var(--ios-separator)] bg-white/65 px-3 py-2 text-sm"
                  key={model.id}
                >
                  <p className="min-w-0 truncate font-semibold">{model.id}</p>
                  <p className="mt-1 text-xs ios-muted">上游 {model.upstreamId}</p>
                </div>
              ))}
            </div>
          </div>

          <form className="grid gap-2 sm:grid-cols-[1fr_auto]" onSubmit={onCreateApiKey}>
            <input
              className="ios-input"
              disabled={!canCreateApiKey}
              onChange={(event) => setApiKeyName(event.target.value)}
              placeholder="Key 名称"
              value={apiKeyName}
            />
            <button
              className="ios-button-primary app-action-button flex h-10 items-center justify-center gap-2 px-4 disabled:opacity-60"
              disabled={!canCreateApiKey || creatingKey}
              type="submit"
            >
              {creatingKey ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              创建 Key
            </button>
          </form>

          {loadingKeys ? (
            <div className="grid min-h-24 place-items-center text-stone-500">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : apiKeys.length === 0 ? (
            <div className="rounded-lg bg-white/45 px-3 py-8 text-center text-sm ios-muted">
              暂无 API Key
            </div>
          ) : (
            <div className="grid gap-2">
              {apiKeys.map((key) => (
                <div
                  className="grid gap-3 rounded-lg border border-[color:var(--ios-separator)] bg-white/55 p-3 md:grid-cols-[1fr_auto]"
                  key={key.id}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        className="ios-input h-9 max-w-xs text-sm"
                        onBlur={(event) => {
                          if (event.target.value.trim() && event.target.value.trim() !== key.name) {
                            onUpdateApiKey(key, { name: event.target.value.trim() });
                          }
                        }}
                        defaultValue={key.name}
                      />
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${key.active ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                        {key.active ? "启用" : "停用"}
                      </span>
                    </div>
                    <p className="mt-2 truncate text-xs ios-muted">
                      {key.keyPrefix}... · 创建 {new Date(key.createdAt).toLocaleString()}
                      {key.lastUsedAt ? ` · 最近使用 ${new Date(key.lastUsedAt).toLocaleString()}` : ""}
                    </p>
                    <div className="mt-2 flex items-center gap-2 rounded-lg border border-[color:var(--ios-separator)] bg-white/80 px-2 py-1.5">
                      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-xs leading-7">
                        {key.apiKey || "旧 Key 无法查看明文，请重新创建后复制"}
                      </code>
                      <button
                        className="app-action-button grid size-7 shrink-0 place-items-center rounded-lg text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 disabled:opacity-40"
                        disabled={!key.apiKey}
                        onClick={() => onCopyApiKey(key)}
                        title="复制"
                        type="button"
                      >
                        <Copy className="size-4" />
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 md:justify-end">
                    <button
                      className="ios-button-secondary app-action-button flex h-9 items-center gap-2 px-3 text-sm disabled:opacity-60"
                      disabled={!key.apiKey}
                      onClick={() => onOpenApiGuide(key)}
                      type="button"
                    >
                      <BookOpen className="size-4" />
                      教程
                    </button>
                    <button
                      className="ios-button-secondary app-action-button flex h-9 items-center gap-2 px-3 text-sm disabled:opacity-60"
                      disabled={savingKeyId === key.id}
                      onClick={() => onUpdateApiKey(key, { active: !key.active })}
                      type="button"
                    >
                      <Shield className="size-4" />
                      {key.active ? "停用" : "启用"}
                    </button>
                    <button
                      className="ios-icon-button app-action-button text-red-600 disabled:opacity-60"
                      disabled={savingKeyId === key.id}
                      onClick={() => onSetDeleteKeyId(key.id)}
                      title="删除"
                      type="button"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <ApiGuideDialog
        apiKey={selectedGuideApiKey?.apiKey}
        models={apiModels}
        onClose={() => setApiGuideOpen(false)}
        onCopy={onCopyText}
        onDownload={onDownloadTextFile}
        open={apiGuideOpen}
        origin={origin}
        siteName={siteSettings.siteName}
      />
    </>
  );
}
