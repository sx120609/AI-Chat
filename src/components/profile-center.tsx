"use client";

import {
  ArrowLeft,
  BookOpen,
  Braces,
  Check,
  Copy,
  Download,
  FileCode2,
  KeyRound,
  Loader2,
  Lock,
  Plus,
  Save,
  Shield,
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
  type PersonalizationLevel,
  type PersonalizationSettings
} from "@/lib/personalization";
import type {
  ChatModelView,
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

type ProfileTab = "overview" | "personalization" | "security" | "api";
type ApiGuideTool = "codex" | "opencode" | "claude-router";
type ApiGuideOs = "unix" | "windows";

function groupLabel(group: string) {
  return group === "VIP" ? "VIP" : "普通";
}

function memorySourceLabel(source: string) {
  return source === "chat" ? "聊天保存" : "手动添加";
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

const LEVEL_OPTIONS: SelectOption<PersonalizationLevel>[] = [
  { label: "默认", value: "default" },
  { label: "少一点", value: "low" },
  { label: "适中", value: "medium" },
  { label: "更多", value: "high" }
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
    description: "风格、语调与记忆",
    icon: Sparkles
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
    hint: "适合 Codex CLI，使用 Responses API 和 auth.json。",
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
  model,
  siteName
}: {
  baseUrl: string;
  model: string;
  siteName: string;
}) {
  return [
    'model_provider = "lowiq"',
    `model = "${model}"`,
    `review_model = "${model}"`,
    'model_reasoning_effort = "high"',
    'disable_response_storage = true',
    'network_access = "enabled"',
    'windows_wsl_setup_acknowledged = true',
    "",
    "[model_providers.lowiq]",
    `name = "${siteName || "AI Gateway"}"`,
    `base_url = "${baseUrl}"`,
    'wire_api = "responses"',
    'requires_openai_auth = true',
    "",
    "[features]",
    "goals = true"
  ].join("\n");
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
      `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("${encoded}")) | Set-Content -Path (Join-Path $dir "config.json") -Encoding UTF8`,
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
  const keyValue = apiKey || "sk-user-在这里替换成你的 API Key";
  const primaryModel = models[0]?.id || "gpt-5.5";
  const codexConfig = useMemo(
    () => buildCodexConfig({ baseUrl, model: primaryModel, siteName }),
    [baseUrl, primaryModel, siteName]
  );
  const codexAuth = useMemo(
    () =>
      jsonConfig({
        OPENAI_API_KEY: keyValue
      }),
    [keyValue]
  );
  const openCodeConfig = useMemo(
    () => buildOpenCodeConfig({ baseUrl, models, siteName }),
    [baseUrl, models, siteName]
  );
  const openCodeAuth = useMemo(() => buildOpenCodeAuth(keyValue), [keyValue]);
  const claudeRouterConfig = useMemo(
    () => buildClaudeRouterConfig({ apiKey: keyValue, baseUrl, models, siteName }),
    [baseUrl, keyValue, models, siteName]
  );
  const claudeRouterImportCommand = useMemo(
    () => buildClaudeRouterImportCommand({ config: claudeRouterConfig, os }),
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
          {!apiKey ? (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
              还没有可查看的 API Key。先创建一个新 Key，或使用一次旧 Key 后再回来复制真实配置。
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
                <p className="text-sm leading-6 text-stone-700">
                  Codex CLI 使用 Responses API。把配置放到 Codex 配置目录，模型名称使用下方“支持的模型”里的 ID。
                </p>
                <ApiCodeBlock
                  label={os === "windows" ? "%USERPROFILE%\\.codex\\config.toml" : "~/.codex/config.toml"}
                  onCopy={onCopy}
                  value={codexConfig}
                />
                <ApiCodeBlock
                  label={os === "windows" ? "%USERPROFILE%\\.codex\\auth.json" : "~/.codex/auth.json"}
                  onCopy={onCopy}
                  value={codexAuth}
                />
              </>
            ) : null}

            {tool === "opencode" ? (
              <>
                <p className="text-sm leading-6 text-stone-700">
                  OpenCode 使用 OpenAI-compatible provider。配置写入项目根目录的
                  <code className="mx-1 rounded bg-white/70 px-1">opencode.json</code>
                  或全局配置，Key 可放入 OpenCode 的 auth 文件。
                </p>
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
                      会写入 <code>~/.claude-code-router/config.json</code>，然后用 <code>ccr code</code> 启动。
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
                    onClick={() =>
                      void onCopy(claudeRouterImportCommand, "Claude Router 一键导入命令已复制。")
                    }
                    type="button"
                  >
                    <Terminal className="size-4" />
                    复制导入命令
                  </button>
                </div>
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
  const [newMemoryContent, setNewMemoryContent] = useState("");
  const [canCreateApiKey, setCanCreateApiKey] = useState(user.userGroup === "VIP");
  const [origin, setOrigin] = useState("");
  const [deleteKeyId, setDeleteKeyId] = useState<string | null>(null);
  const [deleteMemoryId, setDeleteMemoryId] = useState<string | null>(null);
  const [clearMemoriesOpen, setClearMemoriesOpen] = useState(false);
  const [apiGuideOpen, setApiGuideOpen] = useState(false);
  const [apiGuideKeyId, setApiGuideKeyId] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [loadingMemories, setLoadingMemories] = useState(true);
  const [savingKeyId, setSavingKeyId] = useState<string | null>(null);
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
    const response = await fetch("/api/profile/memories");
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

  useEffect(() => {
    setOrigin(window.location.origin);
    void loadApiKeys();
    void loadMemories();
  }, [loadApiKeys, loadMemories]);

  const revealableApiKeys = useMemo(() => apiKeys.filter((key) => key.apiKey), [apiKeys]);
  const selectedGuideApiKey = useMemo(
    () =>
      revealableApiKeys.find((key) => key.id === apiGuideKeyId) ??
      revealableApiKeys[0] ??
      null,
    [apiGuideKeyId, revealableApiKeys]
  );

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

          <nav className="ios-panel motion-lift grid gap-2 p-2 sm:grid-cols-2 lg:grid-cols-4">
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
                  自定义指令
                </label>
                <textarea
                  className="ios-input min-h-20 w-full resize-y py-3 text-sm leading-6"
                  id="custom-instructions"
                  maxLength={900}
                  onChange={(event) => updatePersonalization({ customInstructions: event.target.value })}
                  placeholder="其他行为、风格和语调偏好设置"
                  value={personalization.customInstructions}
                />
              </div>

              <div className="px-4 py-4">
                <h3 className="text-sm font-semibold text-stone-950">关于你</h3>
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

              <ToggleRow
                checked={personalization.memoryEnabled}
                description="开启后，聊天会引用上面的个人信息和下方已保存记忆，并响应你明确说出的“记住/忘记”。"
                label="记忆"
                onChange={(checked) => updatePersonalization({ memoryEnabled: checked })}
              />

              <div className="grid gap-4 px-4 py-4">
                <div className="grid gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-stone-950">保存的记忆</h3>
                      <p className="mt-1 text-sm leading-5 ios-muted">
                        AI 会把这些内容作为长期上下文；关闭上方开关后不会引用，也不会新增聊天记忆。
                      </p>
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
                ) : memories.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[color:var(--ios-separator)] bg-white/45 px-3 py-8 text-center text-sm ios-muted">
                    暂无保存的记忆。你可以手动添加，或在聊天里说“记住……”。
                  </div>
                ) : (
                  <div className="grid gap-2">
                    {memories.map((memory) => (
                      <div
                        className="grid gap-3 rounded-lg border border-[color:var(--ios-separator)] bg-white/60 p-3 sm:grid-cols-[1fr_auto]"
                        key={memory.id}
                      >
                        <div className="min-w-0">
                          <p className="break-words text-sm leading-6 text-stone-900">{memory.content}</p>
                          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs ios-muted">
                            <span className="rounded-full bg-white/80 px-2 py-1 font-semibold">
                              {memorySourceLabel(memory.source)}
                            </span>
                            <span>更新 {new Date(memory.updatedAt).toLocaleString()}</span>
                          </p>
                        </div>
                        <button
                          className="ios-icon-button app-action-button self-start text-red-600 disabled:opacity-60"
                          disabled={savingMemory}
                          onClick={() => setDeleteMemoryId(memory.id)}
                          title="删除记忆"
                          type="button"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
                <p className="text-xs ios-muted">{personalizationPayloadSize}/3000</p>
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
