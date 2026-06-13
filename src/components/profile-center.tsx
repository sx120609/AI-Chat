"use client";

import {
  ArrowLeft,
  Archive,
  Bell,
  BookOpen,
  Bot,
  Braces,
  Check,
  Clock3,
  Copy,
  Database,
  Download,
  File as FileIcon,
  FileCode2,
  FolderOpen,
  Globe2,
  KeyRound,
  Link2,
  Loader2,
  Lock,
  Pencil,
  PlugZap,
  Plus,
  RotateCcw,
  Save,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  Trash2,
  UserRound,
  X
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { DocumentTitle } from "@/components/document-title";
import { SiteConfirmDialog } from "@/components/site-dialog";
import { SiteLogo } from "@/components/site-logo";
import { formatCents, formatNumber } from "@/lib/format";
import {
  parsePersonalizationSettings,
  serializePersonalizationSettings,
  type BaseStyle,
  type ChatPersonality,
  type PersonalizationLevel,
  type PersonalizationSettings
} from "@/lib/personalization";
import type {
  ChatModelView,
  ReasoningEffort,
  SiteSettingsView,
  UsageSummary,
  UserApiKeyView,
  UserMemoryView,
  UserView
} from "@/types/gateway";

type ProfileCenterProps = {
  apiModels: ChatModelView[];
  initialUser: UserView;
  initialUsage: UsageSummary;
  siteSettings: SiteSettingsView;
};

type ApiKeysPayload = {
  canCreate: boolean;
  keys: UserApiKeyView[];
};

type MemoriesPayload = {
  memories: UserMemoryView[];
};

type SharedLinkView = {
  id: string;
  token: string;
  conversationId: string;
  title: string;
  model: string;
  mode: string;
  conversationUpdatedAt: string;
  createdAt: string;
  updatedAt: string;
};

type SharedLinksPayload = {
  links: SharedLinkView[];
};

type FileLibraryItem = {
  id: string;
  conversationId?: string | null;
  messageId?: string | null;
  kind: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  temporary?: boolean;
  conversationTitle?: string | null;
  conversationArchivedAt?: string | null;
  createdAt: string;
};

type FileLibraryPayload = {
  files: FileLibraryItem[];
};

type UsageBucketView = {
  cachedPromptTokens: number;
  completionTokens: number;
  costCents: number;
  key: string;
  label: string;
  promptTokens: number;
  reasoningTokens: number;
  records: number;
  totalTokens: number;
};

type UsageBreakdownPayload = {
  byMode: UsageBucketView[];
  byModel: UsageBucketView[];
  byMonth: UsageBucketView[];
  bySurface: UsageBucketView[];
  generatedAt: string;
  recentRecords: Array<{
    createdAt: string;
    estimatedCostCents: number;
    id: string;
    mode: string;
    model: string;
    surface: string;
    totalTokens: number;
    usageSource: string;
  }>;
  totals: {
    costCents: number;
    records: number;
    totalTokens: number;
  };
};

type ProfileTab = "overview" | "personalization" | "memory" | "tools" | "data" | "security" | "api";
type DataControlAction = "archive_chats" | "delete_chats" | "deactivate_account" | "clear_shared_links";
type InstructionPreset = "concise" | "professional" | "teaching" | "code" | "life";
type ApiGuideTool = "codex" | "opencode" | "claude-router";
type ApiGuideOs = "unix" | "windows";
const LOWIQ_API_KEY_ENV = "LOWIQ_API_KEY";
const CODEX_MODEL_CATALOG_PATH_PLACEHOLDER = "__LOWIQ_CODEX_MODEL_CATALOG_JSON__";

function groupLabel(group: string) {
  return group === "VIP" ? "VIP" : "普通";
}

function memorySourceLabel(source: string) {
  return source === "chat" ? "聊天保存" : "手动添加";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

type SelectOption<T extends string> = {
  label: string;
  value: T;
};

const BASE_STYLE_OPTIONS: SelectOption<BaseStyle>[] = [
  { label: "默认", value: "default" },
  { label: "简洁直接", value: "concise" },
  { label: "均衡", value: "balanced" },
  { label: "详细深入", value: "detailed" }
];

const PERSONALITY_OPTIONS: SelectOption<ChatPersonality>[] = [
  { label: "默认", value: "default" },
  { label: "友好", value: "friendly" },
  { label: "直接", value: "direct" },
  { label: "鼓励型", value: "encouraging" },
  { label: "专业型", value: "professional" }
];

const LEVEL_OPTIONS: SelectOption<PersonalizationLevel>[] = [
  { label: "默认", value: "default" },
  { label: "少一点", value: "low" },
  { label: "适中", value: "medium" },
  { label: "更多", value: "high" }
];

const REASONING_OPTIONS: SelectOption<ReasoningEffort>[] = [
  { label: "低", value: "low" },
  { label: "中", value: "medium" },
  { label: "高", value: "high" },
  { label: "极高", value: "xhigh" }
];

const INSTRUCTION_PRESETS: Array<{
  id: InstructionPreset;
  label: string;
  description: string;
}> = [
  { id: "concise", label: "简洁", description: "先给结论，少铺垫。" },
  { id: "professional", label: "专业", description: "准确、稳健、少口语。" },
  { id: "teaching", label: "教学", description: "分步骤解释原因。" },
  { id: "code", label: "代码助手", description: "重视实现、验证和边界。" },
  { id: "life", label: "生活助手", description: "自然体贴，适合日常决策。" }
];

const APP_SETTING_OPTIONS: Array<{
  icon: typeof Globe2;
  key: keyof PersonalizationSettings["apps"];
  label: string;
}> = [
  { icon: Globe2, key: "webSearch", label: "联网搜索" },
  { icon: FileIcon, key: "fileLibrary", label: "文件库" },
  { icon: PlugZap, key: "mcpConnectors", label: "第三方 MCP" },
  { icon: Bot, key: "knowledgeBase", label: "知识库" }
];

const profileTabs: Array<{
  id: ProfileTab;
  label: string;
  description: string;
  icon: typeof UserRound;
}> = [
  {
    id: "overview",
    label: "资料",
    description: "昵称、邮箱与余额",
    icon: UserRound
  },
  {
    id: "personalization",
    label: "个性化",
    description: "指令、语调与人格",
    icon: Sparkles
  },
  {
    id: "memory",
    label: "记忆",
    description: "保存、引用与归档",
    icon: Database
  },
  {
    id: "tools",
    label: "工具",
    description: "搜索、模型与连接器",
    icon: SlidersHorizontal
  },
  {
    id: "data",
    label: "数据",
    description: "导出、文件与分享",
    icon: FolderOpen
  },
  {
    id: "security",
    label: "安全",
    description: "登录密码",
    icon: Lock
  },
  {
    id: "api",
    label: "个人 API",
    description: "模型、Base URL 与 Key",
    icon: KeyRound
  }
];

const apiGuideTools: Array<{
  id: ApiGuideTool;
  label: string;
  description: string;
  hint: string;
  icon: typeof Terminal;
}> = [
  {
    id: "codex",
    label: "Codex CLI",
    description: "Responses API",
    hint: "适合 Codex CLI，使用独立 LOWIQ_API_KEY，不占用 OPENAI_API_KEY。",
    icon: Terminal
  },
  {
    id: "opencode",
    label: "OpenCode",
    description: "OpenAI-compatible",
    hint: "适合 OpenCode，自定义 OpenAI-compatible provider。",
    icon: FileCode2
  },
  {
    id: "claude-router",
    label: "Claude Router",
    description: "Switch 兼容",
    hint: "适合 Claude Code Router / switch 类工具，走 Chat Completions 兼容入口。",
    icon: Braces
  }
];

const apiGuideOsOptions: Array<{
  id: ApiGuideOs;
  label: string;
}> = [
  { id: "unix", label: "macOS / Linux" },
  { id: "windows", label: "Windows" }
];

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

function shellSingleQuote(value: string) {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

function powerShellDoubleQuote(value: string) {
  return `"${value.replace(/`/g, "``").replace(/"/g, '`"')}"`;
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

function PreferenceSelect<T extends string>({
  ariaLabel,
  label,
  onChange,
  options,
  value
}: {
  ariaLabel?: string;
  label?: string;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  value: T;
}) {
  return (
    <label className="flex min-h-12 items-center justify-between gap-4">
      {label ? <span className="text-sm font-medium text-stone-900">{label}</span> : null}
      <select
        aria-label={ariaLabel || label}
        className="ios-input ml-auto h-10 w-36 shrink-0 bg-white/72 px-3 text-sm font-semibold"
        onChange={(event) => onChange(event.target.value as T)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ToggleRow({
  checked,
  description,
  label,
  onChange
}: {
  checked: boolean;
  description?: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex min-h-16 items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-stone-950">{label}</p>
        {description ? <p className="mt-1 text-sm leading-5 ios-muted">{description}</p> : null}
      </div>
      <button
        aria-checked={checked}
        className={`relative h-7 w-12 shrink-0 rounded-full transition ${
          checked ? "bg-[color:var(--claude-accent)]" : "bg-stone-200"
        }`}
        onClick={() => onChange(!checked)}
        role="switch"
        type="button"
      >
        <span
          className={`absolute top-1 size-5 rounded-full bg-white shadow-sm transition ${
            checked ? "left-6" : "left-1"
          }`}
        />
      </button>
    </div>
  );
}

function UsageBucketList({ buckets, title }: { buckets: UsageBucketView[]; title: string }) {
  return (
    <div className="rounded-lg border border-[color:var(--ios-separator)] bg-white/45 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-stone-950">{title}</h3>
        <span className="text-xs ios-muted">{buckets.length} 项</span>
      </div>
      {buckets.length === 0 ? (
        <p className="py-6 text-center text-sm ios-muted">暂无数据</p>
      ) : (
        <div className="grid gap-2">
          {buckets.map((bucket) => (
            <div
              className="grid gap-1 rounded-lg bg-white/60 px-3 py-2 text-sm"
              key={bucket.key}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate font-semibold text-stone-900">{bucket.label}</span>
                <span className="shrink-0 text-xs font-semibold ios-muted">{formatCents(bucket.costCents)}</span>
              </div>
              <p className="text-xs ios-muted">
                {formatNumber(bucket.totalTokens)} tokens · {formatNumber(bucket.records)} 条
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
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
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-stone-950/35 px-3 pb-3 pt-[calc(0.75rem+var(--app-safe-area-top,0px))] backdrop-blur-sm sm:items-center sm:p-6">
      <button aria-label="关闭教程" className="absolute inset-0" onClick={onClose} type="button" />
      <section
        aria-modal="true"
        className="app-modal-panel relative flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-[1.25rem] border border-[color:var(--ios-separator)] bg-[color:var(--claude-surface)] text-stone-950 shadow-[0_26px_90px_rgba(18,42,35,0.24)] ring-1 ring-white/70"
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

export function ProfileCenter({ apiModels, initialUser, initialUsage, siteSettings }: ProfileCenterProps) {
  const [user, setUser] = useState(initialUser);
  const [name, setName] = useState(initialUser.name);
  const [personalization, setPersonalization] = useState<PersonalizationSettings>(() =>
    parsePersonalizationSettings(initialUser.aiStylePrompt)
  );
  const [activeTab, setActiveTab] = useState<ProfileTab>("overview");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [apiKeyName, setApiKeyName] = useState("个人 API Key");
  const [apiKeys, setApiKeys] = useState<UserApiKeyView[]>([]);
  const [memories, setMemories] = useState<UserMemoryView[]>([]);
  const [sharedLinks, setSharedLinks] = useState<SharedLinkView[]>([]);
  const [fileLibrary, setFileLibrary] = useState<FileLibraryItem[]>([]);
  const [usageBreakdown, setUsageBreakdown] = useState<UsageBreakdownPayload | null>(null);
  const [newMemoryContent, setNewMemoryContent] = useState("");
  const [canCreateApiKey, setCanCreateApiKey] = useState(user.userGroup === "VIP");
  const [origin, setOrigin] = useState("");
  const [deleteKeyId, setDeleteKeyId] = useState<string | null>(null);
  const [deleteMemoryId, setDeleteMemoryId] = useState<string | null>(null);
  const [clearMemoriesOpen, setClearMemoriesOpen] = useState(false);
  const [dataControlAction, setDataControlAction] = useState<DataControlAction | null>(null);
  const [editingMemoryContent, setEditingMemoryContent] = useState("");
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [showArchivedMemories, setShowArchivedMemories] = useState(false);
  const [apiGuideOpen, setApiGuideOpen] = useState(false);
  const [apiGuideKeyId, setApiGuideKeyId] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [loadingMemories, setLoadingMemories] = useState(true);
  const [loadingDataLists, setLoadingDataLists] = useState(true);
  const [savingKeyId, setSavingKeyId] = useState<string | null>(null);
  const [savingDataAction, setSavingDataAction] = useState(false);
  const [savingFileId, setSavingFileId] = useState<string | null>(null);
  const [savingSharedLinkId, setSavingSharedLinkId] = useState<string | null>(null);
  const [savingMemory, setSavingMemory] = useState(false);
  const [creatingKey, setCreatingKey] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadApiKeys = useCallback(async () => {
    setLoadingKeys(true);
    const response = await fetch("/api/profile/api-keys");
    const payload = (await response.json().catch(() => null)) as
      | (ApiKeysPayload & { error?: string })
      | null;

    if (response.ok && payload) {
      setApiKeys(payload.keys);
      setCanCreateApiKey(payload.canCreate);
    } else {
      setError(payload?.error || "读取 API Key 失败。");
    }

    setLoadingKeys(false);
  }, []);

  const loadMemories = useCallback(async () => {
    setLoadingMemories(true);
    const response = await fetch("/api/profile/memories?includeArchived=1");
    const payload = (await response.json().catch(() => null)) as
      | (MemoriesPayload & { error?: string })
      | null;

    if (response.ok && payload) {
      setMemories(payload.memories);
    } else {
      setError(payload?.error || "读取记忆失败。");
    }

    setLoadingMemories(false);
  }, []);

  const loadDataLists = useCallback(async () => {
    setLoadingDataLists(true);
    const [sharedResponse, fileResponse, usageResponse] = await Promise.all([
      fetch("/api/profile/shared-links"),
      fetch("/api/profile/file-library"),
      fetch("/api/profile/usage")
    ]);
    const sharedPayload = (await sharedResponse.json().catch(() => null)) as
      | (SharedLinksPayload & { error?: string })
      | null;
    const filePayload = (await fileResponse.json().catch(() => null)) as
      | (FileLibraryPayload & { error?: string })
      | null;
    const usagePayload = (await usageResponse.json().catch(() => null)) as
      | (UsageBreakdownPayload & { error?: string })
      | null;

    if (sharedResponse.ok && sharedPayload) {
      setSharedLinks(sharedPayload.links);
    } else {
      setError(sharedPayload?.error || "读取共享链接失败。");
    }

    if (fileResponse.ok && filePayload) {
      setFileLibrary(filePayload.files);
    } else {
      setError(filePayload?.error || "读取文件库失败。");
    }

    if (usageResponse.ok && usagePayload) {
      setUsageBreakdown(usagePayload);
    } else {
      setError(usagePayload?.error || "读取用量明细失败。");
    }

    setLoadingDataLists(false);
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
    void loadApiKeys();
    void loadDataLists();
    void loadMemories();
  }, [loadApiKeys, loadDataLists, loadMemories]);

  const revealableApiKeys = useMemo(() => apiKeys.filter((key) => key.apiKey), [apiKeys]);
  const selectedGuideApiKey = useMemo(
    () =>
      revealableApiKeys.find((key) => key.id === apiGuideKeyId) ??
      revealableApiKeys[0] ??
      null,
    [apiGuideKeyId, revealableApiKeys]
  );
  const activeMemories = useMemo(
    () => memories.filter((memory) => !memory.archivedAt),
    [memories]
  );
  const archivedMemories = useMemo(
    () => memories.filter((memory) => memory.archivedAt),
    [memories]
  );
  const visibleMemories = showArchivedMemories ? memories : activeMemories;
  const modelOptions = useMemo<SelectOption<string>[]>(
    () => [
      { label: "跟随默认", value: "" },
      ...apiModels.map((model) => ({ label: model.label || model.id, value: model.id }))
    ],
    [apiModels]
  );
  const dataActionCopy: Record<DataControlAction, { confirmLabel: string; description: string; title: string }> = {
    archive_chats: {
      confirmLabel: "归档",
      description: "所有未归档聊天会从默认聊天列表中隐藏，但不会删除内容。",
      title: "归档所有聊天"
    },
    delete_chats: {
      confirmLabel: "清空",
      description: "所有聊天、消息和关联附件都会删除。这个操作无法撤销。",
      title: "清空所有聊天"
    },
    deactivate_account: {
      confirmLabel: "停用",
      description: "停用后这个账号不能继续使用，需要管理员重新启用。",
      title: "停用账号"
    },
    clear_shared_links: {
      confirmLabel: "全部失效",
      description: "所有已分享出去的会话链接都会立即失效。",
      title: "取消全部共享链接"
    }
  };

  function openApiGuide(key?: UserApiKeyView) {
    setApiGuideKeyId(key?.apiKey ? key.id : revealableApiKeys[0]?.id ?? null);
    setApiGuideOpen(true);
    setError("");
  }

  function updatePersonalization(patch: Partial<PersonalizationSettings>) {
    setPersonalization((current) => ({
      ...current,
      ...patch
    }));
  }

  function updateTrait(key: keyof PersonalizationSettings["traits"], value: PersonalizationLevel) {
    setPersonalization((current) => ({
      ...current,
      traits: {
        ...current.traits,
        [key]: value
      }
    }));
  }

  function updateAbout(key: keyof PersonalizationSettings["about"], value: string) {
    setPersonalization((current) => ({
      ...current,
      about: {
        ...current.about,
        [key]: value
      }
    }));
  }

  function updateToolPreference<K extends keyof PersonalizationSettings["toolPreferences"]>(
    key: K,
    value: PersonalizationSettings["toolPreferences"][K]
  ) {
    setPersonalization((current) => ({
      ...current,
      toolPreferences: {
        ...current.toolPreferences,
        [key]: value
      }
    }));
  }

  function updateNotification<K extends keyof PersonalizationSettings["notifications"]>(
    key: K,
    value: PersonalizationSettings["notifications"][K]
  ) {
    setPersonalization((current) => ({
      ...current,
      notifications: {
        ...current.notifications,
        [key]: value
      }
    }));
  }

  function updateAppSetting<K extends keyof PersonalizationSettings["apps"]>(
    key: K,
    value: PersonalizationSettings["apps"][K]
  ) {
    setPersonalization((current) => ({
      ...current,
      apps: {
        ...current.apps,
        [key]: value
      }
    }));
  }

  function applyInstructionPreset(preset: InstructionPreset) {
    const presets: Record<
      InstructionPreset,
      Partial<
        Pick<
          PersonalizationSettings,
          "baseStyle" | "customInstructions" | "personality" | "quickAnswers"
        >
      >
    > = {
      concise: {
        baseStyle: "concise",
        customInstructions: "优先直接回答结论。除非我要求展开，否则只补充最关键的原因和下一步。",
        personality: "direct",
        quickAnswers: true
      },
      professional: {
        baseStyle: "balanced",
        customInstructions: "保持专业、准确和克制。遇到不确定信息时明确说明不确定性，并给出可验证路径。",
        personality: "professional",
        quickAnswers: true
      },
      teaching: {
        baseStyle: "detailed",
        customInstructions: "像老师一样分步骤解释。先给答案，再解释原理、常见误区和练习建议。",
        personality: "encouraging",
        quickAnswers: false
      },
      code: {
        baseStyle: "balanced",
        customInstructions: "回答代码问题时优先给可运行方案，说明改动点、边界条件和验证命令。",
        personality: "professional",
        quickAnswers: true
      },
      life: {
        baseStyle: "balanced",
        customInstructions: "回答日常问题时先帮我理清选择，再给实际可执行建议。语气自然、耐心一点。",
        personality: "friendly",
        quickAnswers: true
      }
    };

    updatePersonalization({
      customizationEnabled: true,
      ...presets[preset]
    });
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingProfile(true);
    setNotice("");
    setError("");

    const response = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        aiStylePrompt: serializePersonalizationSettings(personalization),
        name
      })
    });
    const payload = (await response.json().catch(() => null)) as
      | { error?: string; user?: UserView }
      | null;

    if (!response.ok || !payload?.user) {
      setError(payload?.error || "保存个人资料失败。");
    } else {
      setUser(payload.user);
      setPersonalization(parsePersonalizationSettings(payload.user.aiStylePrompt));
      setNotice("个人资料已保存。");
    }

    setSavingProfile(false);
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingPassword(true);
    setNotice("");
    setError("");

    const response = await fetch("/api/profile/password", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    if (!response.ok) {
      setError(payload?.error || "修改密码失败。");
    } else {
      setCurrentPassword("");
      setNewPassword("");
      setNotice("密码已修改。");
    }

    setSavingPassword(false);
  }

  async function createApiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreatingKey(true);
    setNotice("");
    setError("");

    const response = await fetch("/api/profile/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: apiKeyName })
    });
    const payload = (await response.json().catch(() => null)) as
      | { apiKey?: string; error?: string; key?: UserApiKeyView }
      | null;

    if (!response.ok || !payload?.apiKey || !payload.key) {
      setError(payload?.error || "创建 API Key 失败。");
    } else {
      setApiKeys((current) => [payload.key as UserApiKeyView, ...current]);
      setNotice("API Key 已创建。");
    }

    setCreatingKey(false);
  }

  async function updateApiKey(key: UserApiKeyView, patch: Partial<Pick<UserApiKeyView, "active" | "name">>) {
    setSavingKeyId(key.id);
    setNotice("");
    setError("");

    const response = await fetch(`/api/profile/api-keys/${key.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch)
    });
    const payload = (await response.json().catch(() => null)) as
      | { error?: string; key?: UserApiKeyView }
      | null;

    if (!response.ok || !payload?.key) {
      setError(payload?.error || "更新 API Key 失败。");
    } else {
      setApiKeys((current) => current.map((item) => (item.id === key.id ? payload.key! : item)));
      setNotice("API Key 已更新。");
    }

    setSavingKeyId(null);
  }

  async function deleteApiKey() {
    if (!deleteKeyId) {
      return;
    }

    setSavingKeyId(deleteKeyId);
    setNotice("");
    setError("");

    const response = await fetch(`/api/profile/api-keys/${deleteKeyId}`, {
      method: "DELETE"
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    if (!response.ok) {
      setError(payload?.error || "删除 API Key 失败。");
    } else {
      setApiKeys((current) => current.filter((item) => item.id !== deleteKeyId));
      setNotice("API Key 已删除。");
    }

    setSavingKeyId(null);
    setDeleteKeyId(null);
  }

  async function createMemory() {
    const content = newMemoryContent.trim();

    if (!content) {
      setError("请输入要保存的记忆。");
      return;
    }

    setSavingMemory(true);
    setNotice("");
    setError("");

    const response = await fetch("/api/profile/memories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content })
    });
    const payload = (await response.json().catch(() => null)) as
      | { error?: string; memory?: UserMemoryView }
      | null;

    if (!response.ok || !payload?.memory) {
      setError(payload?.error || "新增记忆失败。");
    } else {
      setMemories((current) => [
        payload.memory as UserMemoryView,
        ...current.filter((memory) => memory.id !== payload.memory?.id)
      ]);
      setNewMemoryContent("");
      setNotice("记忆已保存。");
    }

    setSavingMemory(false);
  }

  function startEditMemory(memory: UserMemoryView) {
    setEditingMemoryId(memory.id);
    setEditingMemoryContent(memory.content);
    setError("");
    setNotice("");
  }

  async function updateMemory(
    memory: UserMemoryView,
    patch: Partial<Pick<UserMemoryView, "content">> & { archived?: boolean }
  ) {
    setSavingMemory(true);
    setNotice("");
    setError("");

    const response = await fetch(`/api/profile/memories/${memory.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch)
    });
    const payload = (await response.json().catch(() => null)) as
      | { error?: string; memory?: UserMemoryView }
      | null;

    if (!response.ok || !payload?.memory) {
      setError(payload?.error || "更新记忆失败。");
    } else {
      setMemories((current) =>
        current.map((item) => (item.id === payload.memory?.id ? payload.memory : item))
      );
      setNotice(patch.archived === true ? "记忆已归档。" : patch.archived === false ? "记忆已恢复。" : "记忆已更新。");
      setEditingMemoryId(null);
      setEditingMemoryContent("");
    }

    setSavingMemory(false);
  }

  async function saveMemoryEdit(memory: UserMemoryView) {
    const content = editingMemoryContent.trim();

    if (!content) {
      setError("记忆内容不能为空。");
      return;
    }

    await updateMemory(memory, { content });
  }

  async function deleteMemory() {
    if (!deleteMemoryId) {
      return;
    }

    setSavingMemory(true);
    setNotice("");
    setError("");

    const response = await fetch(`/api/profile/memories/${deleteMemoryId}`, {
      method: "DELETE"
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    if (!response.ok) {
      setError(payload?.error || "删除记忆失败。");
    } else {
      setMemories((current) => current.filter((memory) => memory.id !== deleteMemoryId));
      setNotice("记忆已删除。");
    }

    setSavingMemory(false);
    setDeleteMemoryId(null);
  }

  async function clearMemories() {
    setSavingMemory(true);
    setNotice("");
    setError("");

    const response = await fetch("/api/profile/memories", {
      method: "DELETE"
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    if (!response.ok) {
      setError(payload?.error || "清空记忆失败。");
    } else {
      setMemories([]);
      setNotice("记忆已清空。");
    }

    setSavingMemory(false);
    setClearMemoriesOpen(false);
  }

  async function exportProfileData() {
    setNotice("");
    setError("");

    const response = await fetch("/api/profile/export");
    const payload = await response.text();

    if (!response.ok) {
      let errorPayload: { error?: string } = {};

      try {
        errorPayload = JSON.parse(payload || "{}") as { error?: string };
      } catch {
        errorPayload = {};
      }

      setError(errorPayload.error || "导出数据失败。");
      return;
    }

    downloadTextFile(`ai-chat-data-${new Date().toISOString().slice(0, 10)}.json`, payload);
    setNotice("数据导出已开始下载。");
  }

  async function exportUsageCsv() {
    setNotice("");
    setError("");

    const response = await fetch("/api/profile/usage?format=csv");
    const payload = await response.text();

    if (!response.ok) {
      setError("导出用量 CSV 失败。");
      return;
    }

    downloadTextFile(`usage-${new Date().toISOString().slice(0, 10)}.csv`, payload);
    setNotice("用量 CSV 已开始下载。");
  }

  async function runDataControlAction(action: DataControlAction) {
    setSavingDataAction(true);
    setNotice("");
    setError("");

    if (action === "clear_shared_links") {
      const response = await fetch("/api/profile/shared-links", { method: "DELETE" });
      const payload = (await response.json().catch(() => null)) as { deleted?: number; error?: string } | null;

      if (!response.ok) {
        setError(payload?.error || "取消共享链接失败。");
      } else {
        setSharedLinks([]);
        setNotice(`已取消 ${payload?.deleted ?? 0} 个共享链接。`);
      }
    } else {
      const response = await fetch("/api/profile/data-controls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action })
      });
      const payload = (await response.json().catch(() => null)) as
        | { affected?: number; error?: string }
        | null;

      if (!response.ok) {
        setError(payload?.error || "数据控制操作失败。");
      } else if (action === "archive_chats") {
        setNotice(`已归档 ${payload?.affected ?? 0} 个聊天。`);
      } else if (action === "delete_chats") {
        setNotice(`已清空 ${payload?.affected ?? 0} 个聊天。`);
        setFileLibrary([]);
        setSharedLinks([]);
      } else {
        setNotice("账号已停用。");
      }
    }

    setSavingDataAction(false);
    setDataControlAction(null);
  }

  async function deleteSharedLink(linkId: string) {
    setSavingSharedLinkId(linkId);
    setNotice("");
    setError("");

    const response = await fetch(`/api/profile/shared-links/${linkId}`, {
      method: "DELETE"
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    if (!response.ok) {
      setError(payload?.error || "取消共享链接失败。");
    } else {
      setSharedLinks((current) => current.filter((link) => link.id !== linkId));
      setNotice("共享链接已取消。");
    }

    setSavingSharedLinkId(null);
  }

  async function deleteFile(fileId: string) {
    setSavingFileId(fileId);
    setNotice("");
    setError("");

    const response = await fetch(`/api/profile/file-library/${fileId}`, {
      method: "DELETE"
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    if (!response.ok) {
      setError(payload?.error || "删除文件失败。");
    } else {
      setFileLibrary((current) => current.filter((file) => file.id !== fileId));
      setNotice("文件已删除。");
    }

    setSavingFileId(null);
  }

  async function copyText(value: string, message = "已复制。") {
    if (!value) {
      return;
    }

    await navigator.clipboard?.writeText(value);
    setNotice(message);
    setError("");
  }

  async function copyApiKey(apiKey: string | null | undefined) {
    if (!apiKey) {
      setError("这个 Key 是旧版本创建的，无法查看明文。请重新创建一个。");
      return;
    }

    await copyText(apiKey, "API Key 已复制。");
  }

  function downloadTextFile(fileName: string, content: string) {
    const blob = new Blob([content], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setNotice("配置文件已下载。");
    setError("");
  }

  const personalizationPayloadSize = serializePersonalizationSettings(personalization).length;

  return (
    <main className="ios-page app-shell app-route-enter flex flex-col text-stone-950">
      <DocumentTitle title={`个人中心 - ${siteSettings.siteName}`} />
      <header className="app-header-center app-fade-in shrink-0 px-4 pb-2 pt-[calc(0.75rem+var(--app-safe-area-top,0px))] sm:px-6 sm:py-4">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <SiteLogo className="size-9 shrink-0" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[color:var(--claude-accent)]">
                {siteSettings.siteName}
              </p>
              <h1 className="truncate text-2xl font-bold leading-8">个人中心</h1>
            </div>
          </div>
          <Link
            className="ios-button-secondary app-action-button flex h-10 items-center gap-2 px-3 text-sm"
            href="/chat"
          >
            <ArrowLeft className="size-4" />
            返回聊天
          </Link>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-2 sm:px-6 sm:pt-3">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
          {notice ? (
            <div className="app-inline-alert rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              {notice}
            </div>
          ) : null}
          {error ? (
            <div className="app-inline-alert rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <nav className="ios-panel motion-lift grid gap-2 p-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            {profileTabs.map((tab) => {
              const TabIcon = tab.icon;
              const selected = activeTab === tab.id;

              return (
                <button
                  className={`app-action-button flex min-h-14 items-center gap-3 rounded-lg px-3 py-2 text-left transition ${
                    selected ? "bg-white text-stone-950 shadow-sm" : "text-stone-600 hover:bg-white/60"
                  }`}
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  type="button"
                >
                  <span
                    className={`grid size-8 shrink-0 place-items-center rounded-lg ${
                      selected ? "bg-[color:var(--claude-accent)] text-white" : "bg-white/70"
                    }`}
                  >
                    <TabIcon className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{tab.label}</span>
                    <span className="block truncate text-[11px] ios-muted">{tab.description}</span>
                  </span>
                </button>
              );
            })}
          </nav>

          {activeTab === "overview" ? (
            <>
          <section className="ios-panel motion-lift grid gap-3 p-4 md:grid-cols-3">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-lg bg-white/75 text-[color:var(--claude-accent)]">
                <UserRound className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{user.name}</p>
                <p className="truncate text-xs ios-muted">{user.email}</p>
              </div>
            </div>
            <div className="rounded-lg bg-white/55 px-3 py-2 text-sm">
              <p className="text-xs ios-muted">用户组</p>
              <p className="mt-1 font-semibold">{groupLabel(user.userGroup)}</p>
            </div>
            <div className="rounded-lg bg-white/55 px-3 py-2 text-sm">
              <p className="text-xs ios-muted">余额</p>
              <p className="mt-1 font-semibold">
                {formatCents(initialUsage.remainingCostCents)} / {formatCents(initialUsage.monthlyCostLimitCents)}
              </p>
              <p className="mt-1 text-xs ios-muted">
                已用 {formatCents(initialUsage.costUsedCents)} · {formatNumber(initialUsage.tokensUsed)} tokens
              </p>
            </div>
          </section>

          <div className="grid gap-4">
            <form className="ios-panel motion-lift p-4" onSubmit={saveProfile}>
              <div className="mb-4 flex items-center gap-2">
                <UserRound className="size-4 text-[color:var(--claude-accent)]" />
                <h2 className="text-base font-semibold">个人资料</h2>
              </div>
              <div className="grid gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium ios-muted">昵称</span>
                  <input
                    className="ios-input w-full"
                    onChange={(event) => setName(event.target.value)}
                    value={name}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium ios-muted">邮箱</span>
                  <input className="ios-input w-full opacity-70" disabled value={user.email} />
                </label>
                <button
                  className="ios-button-primary app-action-button flex h-10 items-center justify-center gap-2 px-4 disabled:opacity-60"
                  disabled={savingProfile}
                  type="submit"
                >
                  {savingProfile ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  保存资料
                </button>
              </div>
            </form>

          </div>
            </>
          ) : null}

          {activeTab === "security" ? (
            <form className="ios-panel motion-lift p-4" onSubmit={changePassword}>
              <div className="mb-4 flex items-center gap-2">
                <Lock className="size-4 text-[color:var(--claude-accent)]" />
                <h2 className="text-base font-semibold">修改密码</h2>
              </div>
              <div className="grid gap-3">
                <input
                  className="ios-input"
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  placeholder="当前密码"
                  type="password"
                  value={currentPassword}
                />
                <input
                  className="ios-input"
                  minLength={8}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="新密码"
                  type="password"
                  value={newPassword}
                />
                <button
                  className="ios-button-primary app-action-button flex h-10 items-center justify-center gap-2 px-4 disabled:opacity-60"
                  disabled={savingPassword}
                  type="submit"
                >
                  {savingPassword ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  更新密码
                </button>
              </div>
            </form>
          ) : null}

          {activeTab === "personalization" ? (
            <form className="ios-panel motion-lift overflow-hidden" onSubmit={saveProfile}>
            <div className="flex items-center gap-2 border-b border-[color:var(--ios-separator)] px-4 py-4">
              <Sparkles className="size-4 text-[color:var(--claude-accent)]" />
              <h2 className="text-base font-semibold">个性化</h2>
            </div>

            <div className="divide-y divide-[color:var(--ios-separator)]">
              <ToggleRow
                checked={personalization.customizationEnabled}
                description="关闭后不会把自定义指令、关于你和人格风格写入系统提示词。"
                label="启用自定义指令"
                onChange={(checked) => updatePersonalization({ customizationEnabled: checked })}
              />

              <div className="px-4 py-4">
                <p className="text-sm font-semibold text-stone-950">预设模板</p>
                <p className="mt-1 text-sm leading-5 ios-muted">快速套用一组常用回答偏好，之后仍可继续微调。</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  {INSTRUCTION_PRESETS.map((preset) => (
                    <button
                      className="app-action-button rounded-lg border border-[color:var(--ios-separator)] bg-white/60 px-3 py-2 text-left transition hover:bg-white"
                      key={preset.id}
                      onClick={() => applyInstructionPreset(preset.id)}
                      type="button"
                    >
                      <span className="block text-sm font-semibold text-stone-950">{preset.label}</span>
                      <span className="mt-1 block text-xs leading-5 ios-muted">{preset.description}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div>
                  <p className="text-sm font-semibold text-stone-950">基本风格和语调</p>
                  <p className="mt-1 text-sm leading-5 ios-muted">设置 AI 回复你的风格和语调。</p>
                </div>
                <PreferenceSelect
                  ariaLabel="基本风格和语调"
                  onChange={(value) => updatePersonalization({ baseStyle: value })}
                  options={BASE_STYLE_OPTIONS}
                  value={personalization.baseStyle}
                />
              </div>

              <div className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div>
                  <p className="text-sm font-semibold text-stone-950">人格</p>
                  <p className="mt-1 text-sm leading-5 ios-muted">选择默认、友好、直接、鼓励型或专业型的回答气质。</p>
                </div>
                <PreferenceSelect
                  ariaLabel="人格"
                  onChange={(value) => updatePersonalization({ personality: value })}
                  options={PERSONALITY_OPTIONS}
                  value={personalization.personality}
                />
              </div>

              <div className="px-4 py-4">
                <p className="text-sm font-semibold text-stone-950">特征</p>
                <p className="mt-1 text-sm leading-5 ios-muted">在基本风格和语调的基础上选择额外的自定义项。</p>
                <div className="mt-3 grid gap-2">
                  <PreferenceSelect
                    label="温和体贴"
                    onChange={(value) => updateTrait("warmth", value)}
                    options={LEVEL_OPTIONS}
                    value={personalization.traits.warmth}
                  />
                  <PreferenceSelect
                    label="热情洋溢"
                    onChange={(value) => updateTrait("enthusiasm", value)}
                    options={LEVEL_OPTIONS}
                    value={personalization.traits.enthusiasm}
                  />
                  <PreferenceSelect
                    label="标题和列表"
                    onChange={(value) => updateTrait("structure", value)}
                    options={LEVEL_OPTIONS}
                    value={personalization.traits.structure}
                  />
                  <PreferenceSelect
                    label="表情符号"
                    onChange={(value) => updateTrait("emoji", value)}
                    options={LEVEL_OPTIONS}
                    value={personalization.traits.emoji}
                  />
                </div>
              </div>

              <ToggleRow
                checked={personalization.quickAnswers}
                description="写入聊天提示词：先给直接答案，再根据问题补充必要细节。"
                label="快速回答"
                onChange={(checked) => updatePersonalization({ quickAnswers: checked })}
              />

              <div className="grid gap-2 px-4 py-4">
                <label className="text-sm font-semibold text-stone-950" htmlFor="custom-instructions">
                  你希望 AI 如何回答？
                </label>
                <textarea
                  className="ios-input min-h-20 w-full resize-y py-3 text-sm leading-6"
                  id="custom-instructions"
                  maxLength={900}
                  onChange={(event) => updatePersonalization({ customInstructions: event.target.value })}
                  placeholder="例如：先给结论；代码问题给验证命令；不确定时直接说明"
                  value={personalization.customInstructions}
                />
              </div>

              <div className="px-4 py-4">
                <h3 className="text-sm font-semibold text-stone-950">你希望 AI 了解你什么？</h3>
                <p className="mt-1 text-sm leading-5 ios-muted">这些内容会作为稳定个人信息进入提示词，不等同于自动新增记忆。</p>
              </div>

              <div className="grid gap-4 px-4 py-4">
                <label className="block">
                  <span className="mb-1 block text-sm font-semibold text-stone-950">昵称</span>
                  <input
                    className="ios-input w-full"
                    maxLength={80}
                    onChange={(event) => updateAbout("nickname", event.target.value)}
                    placeholder="AI 应该怎么称呼你？"
                    value={personalization.about.nickname}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-semibold text-stone-950">职业</span>
                  <input
                    className="ios-input w-full"
                    maxLength={120}
                    onChange={(event) => updateAbout("occupation", event.target.value)}
                    placeholder="家庭主妇、产品经理、开发者..."
                    value={personalization.about.occupation}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-semibold text-stone-950">你的详情</span>
                  <textarea
                    className="ios-input min-h-20 w-full resize-y py-3 text-sm leading-6"
                    maxLength={900}
                    onChange={(event) => updateAbout("details", event.target.value)}
                    placeholder="需要记住的兴趣、价值观或偏好"
                    value={personalization.about.details}
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
                <p className="text-xs ios-muted">{personalizationPayloadSize}/8000</p>
                <button
                  className="ios-button-primary app-action-button flex h-10 items-center justify-center gap-2 px-4 disabled:opacity-60"
                  disabled={savingProfile}
                  type="submit"
                >
                  {savingProfile ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  保存个性化
                </button>
              </div>
            </div>
            </form>
          ) : null}

          {activeTab === "memory" ? (
            <form className="ios-panel motion-lift overflow-hidden" onSubmit={saveProfile}>
              <div className="flex items-center justify-between gap-3 border-b border-[color:var(--ios-separator)] px-4 py-4">
                <div className="flex items-center gap-2">
                  <Database className="size-4 text-[color:var(--claude-accent)]" />
                  <h2 className="text-base font-semibold">记忆</h2>
                </div>
                {memories.length > 0 ? (
                  <button
                    className="ios-button-secondary app-action-button flex h-9 items-center gap-2 px-3 text-sm text-red-600 disabled:opacity-60"
                    disabled={savingMemory}
                    onClick={() => setClearMemoriesOpen(true)}
                    type="button"
                  >
                    <Trash2 className="size-4" />
                    清空
                  </button>
                ) : null}
              </div>

              <div className="divide-y divide-[color:var(--ios-separator)]">
                <ToggleRow
                  checked={personalization.savedMemoryEnabled}
                  description="开启后，聊天会引用下方保存的长期记忆；关闭后不会读取这些记忆。"
                  label="保存的记忆"
                  onChange={(checked) => updatePersonalization({ savedMemoryEnabled: checked })}
                />
                <ToggleRow
                  checked={personalization.chatHistoryMemoryEnabled}
                  description="开启后，AI 可以根据聊天内容判断是否新增、更新或删除记忆。"
                  label="引用聊天历史"
                  onChange={(checked) => updatePersonalization({ chatHistoryMemoryEnabled: checked })}
                />
                <ToggleRow
                  checked={personalization.temporaryChatDefault}
                  description="新对话默认不读取、不写入长期记忆；适合隐私敏感问题。"
                  label="默认临时聊天"
                  onChange={(checked) => updatePersonalization({ temporaryChatDefault: checked })}
                />

                <div className="grid gap-4 px-4 py-4">
                  <div className="grid gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-stone-950">保存的记忆</h3>
                        <p className="mt-1 text-sm leading-5 ios-muted">
                          当前 {activeMemories.length} 条启用，{archivedMemories.length} 条已归档。
                        </p>
                      </div>
                      <button
                        className="ios-button-secondary app-action-button flex h-9 items-center gap-2 px-3 text-sm"
                        onClick={() => setShowArchivedMemories((current) => !current)}
                        type="button"
                      >
                        {showArchivedMemories ? <Database className="size-4" /> : <Archive className="size-4" />}
                        {showArchivedMemories ? "只看启用" : "包含归档"}
                      </button>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                      <input
                        className="ios-input"
                        maxLength={280}
                        onChange={(event) => setNewMemoryContent(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();

                            if (newMemoryContent.trim()) {
                              void createMemory();
                            }
                          }
                        }}
                        placeholder="例如：我更喜欢直接给结论，再补充关键原因"
                        value={newMemoryContent}
                      />
                      <button
                        className="ios-button-primary app-action-button flex h-10 items-center justify-center gap-2 px-4 disabled:opacity-60"
                        disabled={savingMemory || !newMemoryContent.trim()}
                        onClick={() => void createMemory()}
                        type="button"
                      >
                        {savingMemory ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                        添加记忆
                      </button>
                    </div>
                  </div>

                  {loadingMemories ? (
                    <div className="grid min-h-24 place-items-center rounded-lg bg-white/45 text-stone-500">
                      <Loader2 className="size-5 animate-spin" />
                    </div>
                  ) : visibleMemories.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-[color:var(--ios-separator)] bg-white/45 px-3 py-8 text-center text-sm ios-muted">
                      暂无保存的记忆。你可以手动添加，或在聊天里说“记住……”。
                    </div>
                  ) : (
                    <div className="grid gap-2">
                      {visibleMemories.map((memory) => {
                        const archived = Boolean(memory.archivedAt);
                        const editing = editingMemoryId === memory.id;

                        return (
                          <div
                            className={`grid gap-3 rounded-lg border border-[color:var(--ios-separator)] p-3 sm:grid-cols-[1fr_auto] ${
                              archived ? "bg-stone-100/70 opacity-80" : "bg-white/60"
                            }`}
                            key={memory.id}
                          >
                            <div className="min-w-0">
                              {editing ? (
                                <div className="grid gap-2">
                                  <textarea
                                    className="ios-input min-h-20 w-full resize-y py-3 text-sm leading-6"
                                    maxLength={280}
                                    onChange={(event) => setEditingMemoryContent(event.target.value)}
                                    value={editingMemoryContent}
                                  />
                                  <div className="flex flex-wrap gap-2">
                                    <button
                                      className="ios-button-primary app-action-button flex h-9 items-center gap-2 px-3 text-sm disabled:opacity-60"
                                      disabled={savingMemory}
                                      onClick={() => void saveMemoryEdit(memory)}
                                      type="button"
                                    >
                                      <Check className="size-4" />
                                      保存
                                    </button>
                                    <button
                                      className="ios-button-secondary app-action-button flex h-9 items-center gap-2 px-3 text-sm"
                                      onClick={() => {
                                        setEditingMemoryId(null);
                                        setEditingMemoryContent("");
                                      }}
                                      type="button"
                                    >
                                      <X className="size-4" />
                                      取消
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <p className="break-words text-sm leading-6 text-stone-900">{memory.content}</p>
                              )}
                              <p className="mt-2 flex flex-wrap items-center gap-2 text-xs ios-muted">
                                <span className="rounded-full bg-white/80 px-2 py-1 font-semibold">
                                  {memorySourceLabel(memory.source)}
                                </span>
                                {archived ? (
                                  <span className="rounded-full bg-stone-200 px-2 py-1 font-semibold text-stone-600">
                                    已归档
                                  </span>
                                ) : null}
                                <span>更新 {new Date(memory.updatedAt).toLocaleString()}</span>
                              </p>
                            </div>
                            <div className="flex items-start gap-2 sm:justify-end">
                              <button
                                className="ios-icon-button app-action-button text-stone-600 disabled:opacity-60"
                                disabled={savingMemory || editing}
                                onClick={() => startEditMemory(memory)}
                                title="编辑记忆"
                                type="button"
                              >
                                <Pencil className="size-4" />
                              </button>
                              <button
                                className="ios-icon-button app-action-button text-stone-600 disabled:opacity-60"
                                disabled={savingMemory}
                                onClick={() => void updateMemory(memory, { archived: !archived })}
                                title={archived ? "恢复记忆" : "归档记忆"}
                                type="button"
                              >
                                {archived ? <RotateCcw className="size-4" /> : <Archive className="size-4" />}
                              </button>
                              <button
                                className="ios-icon-button app-action-button text-red-600 disabled:opacity-60"
                                disabled={savingMemory}
                                onClick={() => setDeleteMemoryId(memory.id)}
                                title="删除记忆"
                                type="button"
                              >
                                <Trash2 className="size-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
                  <p className="text-xs ios-muted">{personalizationPayloadSize}/8000</p>
                  <button
                    className="ios-button-primary app-action-button flex h-10 items-center justify-center gap-2 px-4 disabled:opacity-60"
                    disabled={savingProfile}
                    type="submit"
                  >
                    {savingProfile ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                    保存记忆设置
                  </button>
                </div>
              </div>
            </form>
          ) : null}

          {activeTab === "tools" ? (
            <form className="ios-panel motion-lift overflow-hidden" onSubmit={saveProfile}>
              <div className="flex items-center gap-2 border-b border-[color:var(--ios-separator)] px-4 py-4">
                <SlidersHorizontal className="size-4 text-[color:var(--claude-accent)]" />
                <h2 className="text-base font-semibold">工具偏好</h2>
              </div>

              <div className="divide-y divide-[color:var(--ios-separator)]">
                <ToggleRow
                  checked={personalization.toolPreferences.securityMode}
                  description="开启后默认关闭联网、图片生成和文件分析，只保留更克制的纯聊天体验。"
                  label="隐私 / 安全模式"
                  onChange={(checked) =>
                    updateToolPreference("securityMode", checked)
                  }
                />
                <ToggleRow
                  checked={personalization.toolPreferences.webSearchDefault}
                  description="新消息默认打开联网搜索；安全模式开启时聊天页会自动关闭。"
                  label="默认启用联网搜索"
                  onChange={(checked) => updateToolPreference("webSearchDefault", checked)}
                />
                <ToggleRow
                  checked={personalization.toolPreferences.imageGenerationEnabled}
                  description="控制聊天页是否默认允许图片生成入口。"
                  label="启用图片生成"
                  onChange={(checked) => updateToolPreference("imageGenerationEnabled", checked)}
                />
                <ToggleRow
                  checked={personalization.toolPreferences.fileAnalysisEnabled}
                  description="控制上传文件后是否默认允许进入文件分析流程。"
                  label="启用文件分析"
                  onChange={(checked) => updateToolPreference("fileAnalysisEnabled", checked)}
                />

                <div className="grid gap-3 px-4 py-4 sm:grid-cols-2">
                  <PreferenceSelect
                    label="默认推理强度"
                    onChange={(value) => updateToolPreference("defaultReasoningEffort", value)}
                    options={REASONING_OPTIONS}
                    value={personalization.toolPreferences.defaultReasoningEffort}
                  />
                  <PreferenceSelect
                    label="默认模型"
                    onChange={(value) => updateToolPreference("defaultModel", value)}
                    options={modelOptions}
                    value={personalization.toolPreferences.defaultModel}
                  />
                </div>

                <div className="px-4 py-4">
                  <div className="mb-3 flex items-center gap-2">
                    <PlugZap className="size-4 text-[color:var(--claude-accent)]" />
                    <h3 className="text-sm font-semibold text-stone-950">应用 / 连接器</h3>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {APP_SETTING_OPTIONS.map(({ icon: Icon, key, label }) => (
                      <button
                        aria-pressed={personalization.apps[key]}
                        className={`app-action-button flex min-h-12 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition ${
                          personalization.apps[key]
                            ? "border-[color:var(--claude-accent)] bg-white"
                            : "border-[color:var(--ios-separator)] bg-white/55"
                        }`}
                        key={key}
                        onClick={() =>
                          updateAppSetting(key, !personalization.apps[key])
                        }
                        type="button"
                      >
                        <span className="flex items-center gap-2 text-sm font-semibold text-stone-900">
                          <Icon className="size-4" />
                          {label}
                        </span>
                        <span className="text-xs ios-muted">
                          {personalization.apps[key] ? "已启用" : "未启用"}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="px-4 py-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Bell className="size-4 text-[color:var(--claude-accent)]" />
                    <h3 className="text-sm font-semibold text-stone-950">通知</h3>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <ToggleRow
                      checked={personalization.notifications.balanceLow}
                      description="余额接近上限时提醒。"
                      label="余额不足"
                      onChange={(checked) => updateNotification("balanceLow", checked)}
                    />
                    <ToggleRow
                      checked={personalization.notifications.apiKeyUsage}
                      description="个人 API Key 使用异常时提醒。"
                      label="API Key 使用"
                      onChange={(checked) => updateNotification("apiKeyUsage", checked)}
                    />
                    <ToggleRow
                      checked={personalization.notifications.taskComplete}
                      description="后台任务或提醒完成时通知。"
                      label="任务完成"
                      onChange={(checked) => updateNotification("taskComplete", checked)}
                    />
                    <ToggleRow
                      checked={personalization.notifications.email}
                      description="允许通过邮箱接收重要通知。"
                      label="邮件通知"
                      onChange={(checked) => updateNotification("email", checked)}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
                  <p className="text-xs ios-muted">项目级偏好和定时任务入口已预留在此设置组。</p>
                  <button
                    className="ios-button-primary app-action-button flex h-10 items-center justify-center gap-2 px-4 disabled:opacity-60"
                    disabled={savingProfile}
                    type="submit"
                  >
                    {savingProfile ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                    保存工具偏好
                  </button>
                </div>
              </div>
            </form>
          ) : null}

          {activeTab === "data" ? (
            <div className="grid gap-4">
              <section className="ios-panel motion-lift overflow-hidden">
                <div className="flex items-center gap-2 border-b border-[color:var(--ios-separator)] px-4 py-4">
                  <FolderOpen className="size-4 text-[color:var(--claude-accent)]" />
                  <h2 className="text-base font-semibold">数据控制</h2>
                </div>
                <div className="grid gap-3 p-4 md:grid-cols-2">
                  <button
                    className="ios-button-secondary app-action-button flex h-11 items-center justify-center gap-2 px-4"
                    onClick={() => void exportProfileData()}
                    type="button"
                  >
                    <Download className="size-4" />
                    导出我的数据
                  </button>
                  <button
                    className="ios-button-secondary app-action-button flex h-11 items-center justify-center gap-2 px-4"
                    onClick={() => setDataControlAction("archive_chats")}
                    type="button"
                  >
                    <Archive className="size-4" />
                    归档所有聊天
                  </button>
                  <button
                    className="ios-button-secondary app-action-button flex h-11 items-center justify-center gap-2 px-4 text-red-600"
                    onClick={() => setDataControlAction("delete_chats")}
                    type="button"
                  >
                    <Trash2 className="size-4" />
                    清空所有聊天
                  </button>
                  <button
                    className="ios-button-secondary app-action-button flex h-11 items-center justify-center gap-2 px-4 text-red-600"
                    onClick={() => setDataControlAction("deactivate_account")}
                    type="button"
                  >
                    <Shield className="size-4" />
                    停用账号
                  </button>
                </div>
              </section>

              <section className="ios-panel motion-lift overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--ios-separator)] px-4 py-4">
                  <div className="flex items-center gap-2">
                    <Database className="size-4 text-[color:var(--claude-accent)]" />
                    <h2 className="text-base font-semibold">用量与账单</h2>
                  </div>
                  <button
                    className="ios-button-secondary app-action-button flex h-9 items-center gap-2 px-3 text-sm"
                    onClick={() => void exportUsageCsv()}
                    type="button"
                  >
                    <Download className="size-4" />
                    导出 CSV
                  </button>
                </div>
                <div className="grid gap-4 p-4">
                  {loadingDataLists ? (
                    <div className="grid min-h-20 place-items-center text-stone-500">
                      <Loader2 className="size-5 animate-spin" />
                    </div>
                  ) : !usageBreakdown ? (
                    <div className="rounded-lg bg-white/45 px-3 py-8 text-center text-sm ios-muted">
                      暂无用量明细。
                    </div>
                  ) : (
                    <>
                      <div className="grid gap-3 md:grid-cols-3">
                        <div className="rounded-lg bg-white/55 p-3">
                          <p className="text-xs ios-muted">记录数</p>
                          <p className="mt-1 text-lg font-semibold">{formatNumber(usageBreakdown.totals.records)}</p>
                        </div>
                        <div className="rounded-lg bg-white/55 p-3">
                          <p className="text-xs ios-muted">Tokens</p>
                          <p className="mt-1 text-lg font-semibold">{formatNumber(usageBreakdown.totals.totalTokens)}</p>
                        </div>
                        <div className="rounded-lg bg-white/55 p-3">
                          <p className="text-xs ios-muted">估算费用</p>
                          <p className="mt-1 text-lg font-semibold">{formatCents(usageBreakdown.totals.costCents)}</p>
                        </div>
                      </div>

                      <div className="grid gap-3 lg:grid-cols-2">
                        <UsageBucketList buckets={usageBreakdown.byModel.slice(0, 6)} title="按模型" />
                        <UsageBucketList buckets={usageBreakdown.bySurface} title="按入口" />
                      </div>

                      <div className="grid gap-2">
                        <h3 className="text-sm font-semibold text-stone-950">最近记录</h3>
                        {usageBreakdown.recentRecords.slice(0, 6).map((record) => (
                          <div
                            className="grid gap-2 rounded-lg border border-[color:var(--ios-separator)] bg-white/55 px-3 py-2 text-sm sm:grid-cols-[1fr_auto]"
                            key={record.id}
                          >
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-stone-900">
                                {record.surface} · {record.model}
                              </p>
                              <p className="mt-1 text-xs ios-muted">
                                {new Date(record.createdAt).toLocaleString()} · {record.usageSource}
                              </p>
                            </div>
                            <p className="text-xs font-semibold ios-muted sm:text-right">
                              {formatNumber(record.totalTokens)} tokens · {formatCents(record.estimatedCostCents)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </section>

              <section className="ios-panel motion-lift overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--ios-separator)] px-4 py-4">
                  <div className="flex items-center gap-2">
                    <Link2 className="size-4 text-[color:var(--claude-accent)]" />
                    <h2 className="text-base font-semibold">共享链接</h2>
                  </div>
                  {sharedLinks.length > 0 ? (
                    <button
                      className="ios-button-secondary app-action-button flex h-9 items-center gap-2 px-3 text-sm text-red-600"
                      onClick={() => setDataControlAction("clear_shared_links")}
                      type="button"
                    >
                      <Trash2 className="size-4" />
                      全部失效
                    </button>
                  ) : null}
                </div>
                <div className="grid gap-2 p-4">
                  {loadingDataLists ? (
                    <div className="grid min-h-20 place-items-center text-stone-500">
                      <Loader2 className="size-5 animate-spin" />
                    </div>
                  ) : sharedLinks.length === 0 ? (
                    <div className="rounded-lg bg-white/45 px-3 py-8 text-center text-sm ios-muted">
                      暂无共享链接。
                    </div>
                  ) : (
                    sharedLinks.map((link) => (
                      <div
                        className="grid gap-3 rounded-lg border border-[color:var(--ios-separator)] bg-white/55 p-3 md:grid-cols-[1fr_auto]"
                        key={link.id}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-stone-950">{link.title}</p>
                          <p className="mt-1 text-xs ios-muted">
                            {link.model} · 创建 {new Date(link.createdAt).toLocaleString()}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 md:justify-end">
                          <button
                            className="ios-button-secondary app-action-button flex h-9 items-center gap-2 px-3 text-sm"
                            onClick={() => void copyText(`${origin}/share/${link.token}`, "共享链接已复制。")}
                            type="button"
                          >
                            <Copy className="size-4" />
                            复制
                          </button>
                          <button
                            className="ios-icon-button app-action-button text-red-600 disabled:opacity-60"
                            disabled={savingSharedLinkId === link.id}
                            onClick={() => void deleteSharedLink(link.id)}
                            title="取消分享"
                            type="button"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section className="ios-panel motion-lift overflow-hidden">
                <div className="flex items-center gap-2 border-b border-[color:var(--ios-separator)] px-4 py-4">
                  <FileIcon className="size-4 text-[color:var(--claude-accent)]" />
                  <h2 className="text-base font-semibold">文件库</h2>
                </div>
                <div className="grid gap-2 p-4">
                  {loadingDataLists ? (
                    <div className="grid min-h-20 place-items-center text-stone-500">
                      <Loader2 className="size-5 animate-spin" />
                    </div>
                  ) : fileLibrary.length === 0 ? (
                    <div className="rounded-lg bg-white/45 px-3 py-8 text-center text-sm ios-muted">
                      暂无上传文件。
                    </div>
                  ) : (
                    fileLibrary.map((file) => (
                      <div
                        className="grid gap-3 rounded-lg border border-[color:var(--ios-separator)] bg-white/55 p-3 md:grid-cols-[1fr_auto]"
                        key={file.id}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-stone-950">{file.originalName}</p>
                          <p className="mt-1 text-xs ios-muted">
                            {file.kind} · {formatBytes(file.sizeBytes)} · {file.temporary ? "临时文件" : "账号文件"} · {file.conversationTitle || "未关联聊天"}
                          </p>
                        </div>
                        <button
                          className="ios-icon-button app-action-button text-red-600 disabled:opacity-60 md:justify-self-end"
                          disabled={savingFileId === file.id}
                          onClick={() => void deleteFile(file.id)}
                          title="删除文件"
                          type="button"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section className="ios-panel motion-lift overflow-hidden">
                <div className="flex items-center gap-2 border-b border-[color:var(--ios-separator)] px-4 py-4">
                  <Clock3 className="size-4 text-[color:var(--claude-accent)]" />
                  <h2 className="text-base font-semibold">任务 / 提醒</h2>
                </div>
                <div className="grid gap-3 p-4 text-sm ios-muted md:grid-cols-3">
                  <div className="rounded-lg bg-white/55 p-3">余额不足提醒</div>
                  <div className="rounded-lg bg-white/55 p-3">每日总结</div>
                  <div className="rounded-lg bg-white/55 p-3">定期学习计划</div>
                </div>
              </section>
            </div>
          ) : null}

          {activeTab === "api" ? (
            <section className="ios-panel motion-lift overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-[color:var(--ios-separator)] px-4 py-3">
              <div className="flex items-center gap-2">
                <KeyRound className="size-4 text-[color:var(--claude-accent)]" />
                <h2 className="text-base font-semibold">个人 API</h2>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  className="ios-button-secondary app-action-button flex h-9 items-center gap-2 px-3 text-sm"
                  onClick={() => openApiGuide()}
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

              <form className="grid gap-2 sm:grid-cols-[1fr_auto]" onSubmit={createApiKey}>
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
                                void updateApiKey(key, { name: event.target.value.trim() });
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
                          onClick={() => void copyApiKey(key.apiKey)}
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
                          onClick={() => openApiGuide(key)}
                          type="button"
                        >
                          <BookOpen className="size-4" />
                          教程
                        </button>
                        <button
                          className="ios-button-secondary app-action-button flex h-9 items-center gap-2 px-3 text-sm disabled:opacity-60"
                          disabled={savingKeyId === key.id}
                          onClick={() => void updateApiKey(key, { active: !key.active })}
                          type="button"
                        >
                          <Shield className="size-4" />
                          {key.active ? "停用" : "启用"}
                        </button>
                        <button
                          className="ios-icon-button app-action-button text-red-600 disabled:opacity-60"
                          disabled={savingKeyId === key.id}
                          onClick={() => setDeleteKeyId(key.id)}
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
          ) : null}
        </div>
      </div>

      <SiteConfirmDialog
        confirmLabel="删除"
        description="删除后使用这个 Key 的客户端会立即失效。"
        onCancel={() => setDeleteKeyId(null)}
        onConfirm={deleteApiKey}
        open={Boolean(deleteKeyId)}
        title="删除 API Key"
        tone="danger"
      />
      <SiteConfirmDialog
        confirmLabel="删除"
        description="删除后这条记忆不会再进入聊天上下文。"
        onCancel={() => setDeleteMemoryId(null)}
        onConfirm={deleteMemory}
        open={Boolean(deleteMemoryId)}
        title="删除记忆"
        tone="danger"
      />
      <SiteConfirmDialog
        confirmLabel="清空"
        description="清空后所有保存的记忆都会删除，不会再进入聊天上下文。"
        onCancel={() => setClearMemoriesOpen(false)}
        onConfirm={clearMemories}
        open={clearMemoriesOpen}
        title="清空全部记忆"
        tone="danger"
      />
      <SiteConfirmDialog
        confirmLabel={
          dataControlAction
            ? savingDataAction
              ? "处理中..."
              : dataActionCopy[dataControlAction].confirmLabel
            : "确认"
        }
        description={dataControlAction ? dataActionCopy[dataControlAction].description : ""}
        onCancel={() => setDataControlAction(null)}
        onConfirm={() => {
          if (dataControlAction) {
            void runDataControlAction(dataControlAction);
          }
        }}
        open={Boolean(dataControlAction)}
        title={dataControlAction ? dataActionCopy[dataControlAction].title : "确认操作"}
        tone="danger"
      />
      <ApiGuideDialog
        apiKey={selectedGuideApiKey?.apiKey}
        models={apiModels}
        onClose={() => setApiGuideOpen(false)}
        onCopy={copyText}
        onDownload={downloadTextFile}
        open={apiGuideOpen}
        origin={origin}
        siteName={siteSettings.siteName}
      />
    </main>
  );
}
