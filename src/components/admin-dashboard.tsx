"use client";

import { FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Check,
  Code2,
  Globe2,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  UserRound,
  X
} from "lucide-react";
import { SiteLogo } from "@/components/site-logo";
import { formatCents, formatNumber } from "@/lib/format";
import {
  CHAT_MODELS,
  DEFAULT_CONTEXT_COMPRESSION_ENABLED,
  DEFAULT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT,
  DEFAULT_CONTEXT_WINDOW_LIMIT_TOKENS,
  DEFAULT_IMAGE_UPSTREAM_MODEL,
  DEFAULT_LONG_CONTEXT_THRESHOLD_TOKENS,
  DEFAULT_REASONING_EFFORT,
  DEFAULT_REASONING_PARAM_MODE,
  DEFAULT_UPSTREAM_MODEL_MAP,
  MAX_CONTEXT_WINDOW_LIMIT_TOKENS,
  MAX_LONG_CONTEXT_THRESHOLD_TOKENS,
  REASONING_EFFORTS,
  REASONING_PARAM_MODES
} from "@/lib/models";
import {
  DEFAULT_SYSTEM_PROMPT_TEMPLATE,
  renderSystemPrompt,
  SYSTEM_PROMPT_MODES
} from "@/lib/system-prompt";
import type {
  AdminUserView,
  AiSettingsView,
  ChatModelView,
  ReasoningEffort,
  ReasoningParamMode,
  Role,
  SystemPromptMode,
  UserView
} from "@/types/gateway";

type AdminDashboardProps = {
  currentUser: UserView;
};

type CreateForm = {
  email: string;
  name: string;
  password: string;
  role: Role;
  monthlyCostLimitCents: number;
};

type SettingsForm = {
  siteName: string;
  siteUrl: string;
  apiBaseUrl: string;
  apiKey: string;
  orgId: string;
  mockResponses: boolean;
  clearApiKey: boolean;
  chatModelMap: Record<string, string>;
  enabledChatModelIds: string[];
  imageModelId: string;
  defaultReasoningEffort: ReasoningEffort;
  reasoningParamMode: ReasoningParamMode;
  contextCompressionEnabled: boolean;
  contextCompressionThresholdPercent: number;
  longContextThresholdTokens: number;
  systemPromptMode: SystemPromptMode;
  customSystemPrompt: string;
  modelSystemPrompts: Record<string, string>;
  codeInterpreterEnabled: boolean;
  codeInterpreterSandbox: string;
  codeInterpreterAllowPackageInstall: boolean;
  codeInterpreterPipIndexUrl: string;
  webSearchEnabled: boolean;
  webSearchProvider: string;
  webSearchMaxResults: number;
};

type DiagnosticCheck = {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
};

type DiagnosticsResult = {
  ok: boolean;
  checks: DiagnosticCheck[];
  modelCount: number;
  chatModelCount: number;
  sample: string[];
};

const emptyForm: CreateForm = {
  email: "",
  name: "",
  password: "",
  role: "USER",
  monthlyCostLimitCents: 5000
};

const emptySettings: SettingsForm = {
  siteName: "Team AI Gateway",
  siteUrl: "",
  apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "",
  orgId: "",
  mockResponses: false,
  clearApiKey: false,
  chatModelMap: DEFAULT_UPSTREAM_MODEL_MAP,
  enabledChatModelIds: [],
  imageModelId: DEFAULT_IMAGE_UPSTREAM_MODEL,
  defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
  reasoningParamMode: DEFAULT_REASONING_PARAM_MODE,
  contextCompressionEnabled: DEFAULT_CONTEXT_COMPRESSION_ENABLED,
  contextCompressionThresholdPercent: DEFAULT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT,
  longContextThresholdTokens: DEFAULT_LONG_CONTEXT_THRESHOLD_TOKENS,
  systemPromptMode: "default",
  customSystemPrompt: "",
  modelSystemPrompts: {},
  codeInterpreterEnabled: false,
  codeInterpreterSandbox: "docker",
  codeInterpreterAllowPackageInstall: false,
  codeInterpreterPipIndexUrl: "https://pypi.org/simple",
  webSearchEnabled: false,
  webSearchProvider: "duckduckgo",
  webSearchMaxResults: 5
};

export function AdminDashboard({ currentUser }: AdminDashboardProps) {
  const [users, setUsers] = useState<AdminUserView[]>([]);
  const [settings, setSettings] = useState<AiSettingsView | null>(null);
  const [settingsForm, setSettingsForm] = useState<SettingsForm>(emptySettings);
  const [form, setForm] = useState<CreateForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [testingSettings, setTestingSettings] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResult | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadUsers = useCallback(async () => {
    const response = await fetch("/api/admin/users");

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error || "加载用户失败。");
    }

    const payload = (await response.json()) as { users: AdminUserView[] };
    setUsers(payload.users);
  }, []);

  const loadSettings = useCallback(async () => {
    const response = await fetch("/api/admin/settings");

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error || "加载 API 设置失败。");
    }

    const payload = (await response.json()) as { settings: AiSettingsView };
    applySettings(payload.settings);
  }, []);

  function applySettings(nextSettings: AiSettingsView) {
    setSettings(nextSettings);
    setSettingsForm({
      siteName: nextSettings.siteName,
      siteUrl: nextSettings.siteUrl,
      apiBaseUrl: nextSettings.apiBaseUrl,
      apiKey: "",
      orgId: nextSettings.orgId,
      mockResponses: nextSettings.mockResponses,
      clearApiKey: false,
      chatModelMap: nextSettings.chatModelMap,
      enabledChatModelIds: nextSettings.enabledChatModelIds,
      imageModelId: nextSettings.imageModelId,
      defaultReasoningEffort: nextSettings.defaultReasoningEffort,
      reasoningParamMode: nextSettings.reasoningParamMode,
      contextCompressionEnabled: nextSettings.contextCompressionEnabled,
      contextCompressionThresholdPercent: nextSettings.contextCompressionThresholdPercent,
      longContextThresholdTokens: nextSettings.longContextThresholdTokens,
      systemPromptMode: nextSettings.systemPromptMode,
      customSystemPrompt: nextSettings.customSystemPrompt,
      modelSystemPrompts: nextSettings.modelSystemPrompts,
      codeInterpreterEnabled: nextSettings.codeInterpreterEnabled,
      codeInterpreterSandbox: nextSettings.codeInterpreterSandbox,
      codeInterpreterAllowPackageInstall: nextSettings.codeInterpreterAllowPackageInstall,
      codeInterpreterPipIndexUrl: nextSettings.codeInterpreterPipIndexUrl,
      webSearchEnabled: nextSettings.webSearchEnabled,
      webSearchProvider: nextSettings.webSearchProvider,
      webSearchMaxResults: nextSettings.webSearchMaxResults
    });
  }

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      await Promise.all([loadUsers(), loadSettings()]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载失败。");
    } finally {
      setLoading(false);
    }
  }, [loadSettings, loadUsers]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (settings?.siteName) {
      document.title = settings.siteName;
    }
  }, [settings?.siteName]);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingSettings(true);
    setError("");
    setNotice("");

    const response = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settingsForm)
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error || "保存 API 设置失败。");
      setSavingSettings(false);
      return;
    }

    const payload = (await response.json()) as { settings: AiSettingsView };
    applySettings(payload.settings);
    setNotice("系统设置已保存。");
    setSavingSettings(false);
  }

  async function testConnection() {
    setTestingSettings(true);
    setError("");
    setNotice("");

    const response = await fetch("/api/admin/settings/test", {
      method: "POST"
    });
    const payload = (await response.json().catch(() => null)) as
      | DiagnosticsResult
      | { error?: string }
      | null;
    const errorMessage = payload && "error" in payload ? payload.error : "";

    if (!response.ok || !payload || errorMessage) {
      setError(errorMessage || "测试连接失败。");
      setTestingSettings(false);
      return;
    }

    const result = payload as DiagnosticsResult;
    setDiagnostics(result);
    setNotice(result.ok ? "连接测试通过。" : "连接测试完成，请查看诊断。");
    setTestingSettings(false);
  }

  async function refreshUpstreamModels() {
    setRefreshingModels(true);
    setError("");
    setNotice("");

    const response = await fetch("/api/admin/settings/models/refresh", {
      method: "POST"
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error || "刷新模型失败。");
      setRefreshingModels(false);
      return;
    }

    const payload = (await response.json()) as { settings: AiSettingsView; count: number };
    applySettings(payload.settings);
    setNotice(`已从上游获取 ${payload.count} 个模型。`);
    setRefreshingModels(false);
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");

    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form)
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error || "创建用户失败。");
      return;
    }

    setForm(emptyForm);
    setNotice("用户已创建。");
    await loadUsers();
  }

  async function saveUser(user: AdminUserView) {
    setSavingId(user.id);
    setError("");
    setNotice("");

    const response = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: user.name,
        role: user.role,
        active: user.active,
        monthlyCostLimitCents: user.monthlyCostLimitCents
      })
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error || "保存失败。");
    } else {
      setNotice("用户设置已保存。");
      await loadUsers();
    }

    setSavingId(null);
  }

  async function resetQuota(userId: string) {
    setSavingId(userId);
    setError("");
    setNotice("");

    const response = await fetch(`/api/admin/users/${userId}/reset-quota`, {
      method: "POST"
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error || "重置失败。");
    } else {
      setNotice("额度窗口已重置。");
      await loadUsers();
    }

    setSavingId(null);
  }

  function patchUser(userId: string, patch: Partial<AdminUserView>) {
    setUsers((current) =>
      current.map((user) => (user.id === userId ? { ...user, ...patch } : user))
    );
  }

  const promptPreviewModel =
    settings?.chatModels.find((item) => settingsForm.enabledChatModelIds.includes(item.id)) ??
    settings?.chatModels[0];
  const defaultPromptPreview = renderSystemPrompt(
    DEFAULT_SYSTEM_PROMPT_TEMPLATE,
    promptPreviewModel?.label || "GPT-5.5"
  );

  return (
    <main className="ios-page app-shell app-route-enter flex flex-col text-stone-950">
      <header className="ios-glass app-header-enter z-20 shrink-0 px-3 pb-3 pt-[calc(0.75rem+var(--app-safe-area-top,0px))] sm:px-5 sm:py-4">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--claude-accent)]">
              <SiteLogo className="size-5 shrink-0" />
              管理后台
            </div>
            <h1 className="mt-1 text-xl font-semibold sm:text-2xl">系统设置</h1>
            <p className="mt-1 text-sm ios-muted">{currentUser.email}</p>
          </div>
          <a className="ios-button-secondary app-action-button flex items-center gap-2 px-3" href="/chat">
            <ArrowLeft className="size-4" />
            返回聊天
          </a>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 sm:px-5 sm:py-6">
        <div className="app-stagger mx-auto max-w-7xl">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {notice ? <Banner tone="success">{notice}</Banner> : null}
        {diagnostics ? <DiagnosticsPanel result={diagnostics} /> : null}

        <section className="ios-panel motion-lift mb-5 p-4">
          <div className="mb-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <div className="grid size-9 place-items-center rounded-lg bg-stone-100 text-[color:var(--claude-accent)]">
                <Globe2 className="size-4" />
              </div>
              <div>
                <h2 className="text-base font-semibold">站点与 API 设置</h2>
                <p className="text-xs ios-muted">
                  Key 已隐藏保存：{settings?.hasApiKey ? settings.apiKeyPreview : "未设置"}
                </p>
              </div>
            </div>
            <div className="flex w-full gap-2 sm:w-auto">
              <button
                className="ios-button-secondary app-action-button flex h-9 flex-1 items-center justify-center gap-2 px-3 text-sm disabled:opacity-50 sm:flex-none"
                disabled={testingSettings}
                onClick={testConnection}
                type="button"
              >
                {testingSettings ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Activity className="size-4" />
                )}
                测试连接
              </button>
              <button className="ios-icon-button app-action-button shrink-0" onClick={loadAll} title="刷新" type="button">
                <RefreshCw className="size-4" />
              </button>
            </div>
          </div>

          <form className="grid gap-3 lg:grid-cols-6" onSubmit={saveSettings}>
            <label className="block lg:col-span-2">
              <span className="mb-1 block text-xs font-medium ios-muted">站点名称</span>
              <input
                className="ios-input w-full"
                onChange={(event) =>
                  setSettingsForm((current) => ({ ...current, siteName: event.target.value }))
                }
                placeholder="Team AI Gateway"
                value={settingsForm.siteName}
              />
            </label>
            <label className="block lg:col-span-4">
              <span className="mb-1 block text-xs font-medium ios-muted">站点地址</span>
              <input
                className="ios-input w-full"
                onChange={(event) =>
                  setSettingsForm((current) => ({ ...current, siteUrl: event.target.value }))
                }
                placeholder="https://chat.example.com"
                value={settingsForm.siteUrl}
              />
            </label>
            <label className="block lg:col-span-3">
              <span className="mb-1 block text-xs font-medium ios-muted">API 地址</span>
              <input
                className="ios-input w-full"
                onChange={(event) =>
                  setSettingsForm((current) => ({ ...current, apiBaseUrl: event.target.value }))
                }
                placeholder="https://api.openai.com/v1"
                value={settingsForm.apiBaseUrl}
              />
            </label>
            <label className="block lg:col-span-2">
              <span className="mb-1 block text-xs font-medium ios-muted">API Key</span>
              <input
                className="ios-input w-full"
                onChange={(event) =>
                  setSettingsForm((current) => ({
                    ...current,
                    apiKey: event.target.value,
                    clearApiKey: false
                  }))
                }
                placeholder={settings?.hasApiKey ? "输入新 Key 后替换" : "输入 API Key"}
                type="password"
                value={settingsForm.apiKey}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium ios-muted">Org ID</span>
              <input
                className="ios-input w-full"
                onChange={(event) =>
                  setSettingsForm((current) => ({ ...current, orgId: event.target.value }))
                }
                placeholder="可选"
                value={settingsForm.orgId}
              />
            </label>
            <label className="block lg:col-span-2">
              <span className="mb-1 block text-xs font-medium ios-muted">默认推理强度</span>
              <select
                className="ios-select w-full"
                onChange={(event) =>
                  setSettingsForm((current) => ({
                    ...current,
                    defaultReasoningEffort: event.target.value as ReasoningEffort
                  }))
                }
                value={settingsForm.defaultReasoningEffort}
              >
                {REASONING_EFFORTS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block lg:col-span-3">
              <span className="mb-1 block text-xs font-medium ios-muted">推理参数格式</span>
              <select
                className="ios-select w-full"
                onChange={(event) =>
                  setSettingsForm((current) => ({
                    ...current,
                    reasoningParamMode: event.target.value as ReasoningParamMode
                  }))
                }
                value={settingsForm.reasoningParamMode}
              >
                {REASONING_PARAM_MODES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium ios-muted">长上下文阈值</span>
              <input
                className="ios-input w-full"
                max={MAX_LONG_CONTEXT_THRESHOLD_TOKENS}
                min={8000}
                onChange={(event) =>
                  setSettingsForm((current) => ({
                    ...current,
                    longContextThresholdTokens: Number(event.target.value)
                  }))
                }
                type="number"
                value={settingsForm.longContextThresholdTokens}
              />
              <span className="mt-1 block text-[11px] ios-muted">
                默认模型按 {formatNumber(DEFAULT_CONTEXT_WINDOW_LIMIT_TOKENS)} tokens 节省成本；启用 GPT-5.5 1M 后可使用 {formatNumber(MAX_CONTEXT_WINDOW_LIMIT_TOKENS)} tokens。
              </span>
            </label>
            <label className="flex min-h-10 items-center gap-2 rounded-lg bg-white/70 px-3 text-sm font-medium text-slate-700">
              <input
                checked={settingsForm.contextCompressionEnabled}
                className="size-4 accent-[color:var(--claude-accent)]"
                onChange={(event) =>
                  setSettingsForm((current) => ({
                    ...current,
                    contextCompressionEnabled: event.target.checked
                  }))
                }
                type="checkbox"
              />
              自动压缩旧上下文
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium ios-muted">压缩触发比例</span>
              <input
                className="ios-input w-full"
                max={95}
                min={50}
                onChange={(event) =>
                  setSettingsForm((current) => ({
                    ...current,
                    contextCompressionThresholdPercent: Number(event.target.value)
                  }))
                }
                type="number"
                value={settingsForm.contextCompressionThresholdPercent}
              />
            </label>

            <div className="ios-list lg:col-span-6">
              <div className="ios-cell px-3 py-2">
                <p className="text-xs font-semibold ios-muted">身份与系统提示词</p>
              </div>
              <div className="grid gap-3 p-3">
                <div className="grid gap-3 lg:grid-cols-3">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium ios-muted">注入模式</span>
                    <select
                      className="ios-select w-full"
                      onChange={(event) =>
                        setSettingsForm((current) => ({
                          ...current,
                          systemPromptMode: event.target.value as SystemPromptMode
                        }))
                      }
                      value={settingsForm.systemPromptMode}
                    >
                      {SYSTEM_PROMPT_MODES.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="rounded-lg bg-stone-50 px-3 py-2 text-xs leading-5 text-stone-600 lg:col-span-2">
                    {SYSTEM_PROMPT_MODES.find((item) => item.id === settingsForm.systemPromptMode)
                      ?.description || ""}
                  </div>
                </div>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium ios-muted">全局追加/自定义系统提示词</span>
                  <textarea
                    className="ios-input min-h-28 w-full resize-y py-2 text-sm leading-6"
                    onChange={(event) =>
                      setSettingsForm((current) => ({
                        ...current,
                        customSystemPrompt: event.target.value
                      }))
                    }
                    placeholder="支持 {model}、{date}、{time} 和 {timezone}。默认 + 追加模式下会保留内置模板。"
                    value={settingsForm.customSystemPrompt}
                  />
                </label>
                <details className="rounded-lg border border-[color:var(--ios-separator)] bg-white/60 px-3 py-2">
                  <summary className="cursor-pointer select-none text-xs font-semibold text-stone-700">
                    查看内置默认提示词
                  </summary>
                  <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-stone-900 p-3 text-xs leading-5 text-stone-50">
                    {defaultPromptPreview}
                  </pre>
                </details>
                <div>
                  <p className="mb-2 text-xs font-medium ios-muted">模型专属系统提示词</p>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {(settings?.chatModels ?? []).map((item) => (
                      <label className="block" key={item.id}>
                        <span className="mb-1 block truncate text-xs font-medium ios-muted">
                          {item.label}
                        </span>
                        <textarea
                          className="ios-input min-h-24 w-full resize-y py-2 text-sm leading-6"
                          onChange={(event) =>
                            setSettingsForm((current) => ({
                              ...current,
                              modelSystemPrompts: {
                                ...current.modelSystemPrompts,
                                [item.id]: event.target.value
                              }
                            }))
                          }
                          placeholder="留空则使用全局设置。支持 {model}、{date}、{time} 和 {timezone}。"
                          value={settingsForm.modelSystemPrompts[item.id] || ""}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="ios-list lg:col-span-6">
              <div className="ios-cell flex items-center gap-2 px-3 py-2">
                <Code2 className="size-4 text-[color:var(--claude-accent)]" />
                <span className="text-xs font-semibold ios-muted">代码解释器沙箱</span>
              </div>
              <div className="grid gap-3 p-3 lg:grid-cols-3">
                <label className="flex min-h-10 items-center gap-2 rounded-lg bg-white/70 px-3 text-sm font-medium text-slate-700">
                  <input
                    checked={settingsForm.codeInterpreterEnabled}
                    className="size-4 accent-[color:var(--claude-accent)]"
                    onChange={(event) =>
                      setSettingsForm((current) => ({
                        ...current,
                        codeInterpreterEnabled: event.target.checked
                      }))
                    }
                    type="checkbox"
                  />
                  启用文件代码分析
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium ios-muted">沙箱</span>
                  <select
                    className="ios-select w-full"
                    onChange={(event) =>
                      setSettingsForm((current) => ({
                        ...current,
                        codeInterpreterSandbox: event.target.value
                      }))
                    }
                    value={settingsForm.codeInterpreterSandbox}
                  >
                    <option value="docker">Docker 容器</option>
                  </select>
                </label>
                <label className="flex min-h-10 items-center gap-2 rounded-lg bg-white/70 px-3 text-sm font-medium text-slate-700">
                  <input
                    checked={settingsForm.codeInterpreterAllowPackageInstall}
                    className="size-4 accent-[color:var(--claude-accent)]"
                    onChange={(event) =>
                      setSettingsForm((current) => ({
                        ...current,
                        codeInterpreterAllowPackageInstall: event.target.checked
                      }))
                    }
                    type="checkbox"
                  />
                  允许沙箱内安装包
                </label>
                <label className="block lg:col-span-2">
                  <span className="mb-1 block text-xs font-medium ios-muted">Python 包源</span>
                  <input
                    className="ios-input w-full"
                    onChange={(event) =>
                      setSettingsForm((current) => ({
                        ...current,
                        codeInterpreterPipIndexUrl: event.target.value
                      }))
                    }
                    placeholder="https://pypi.org/simple"
                    value={settingsForm.codeInterpreterPipIndexUrl}
                  />
                </label>
                <div className="rounded-lg bg-stone-50 px-3 py-2 text-xs leading-5 text-stone-600">
                  模型生成代码只应在容器内执行。未启用时，附件只走内置文本解析，不会运行任意代码。
                </div>
              </div>
            </div>

            <div className="ios-list lg:col-span-6">
              <div className="ios-cell flex items-center gap-2 px-3 py-2">
                <Globe2 className="size-4 text-[color:var(--claude-accent)]" />
                <span className="text-xs font-semibold ios-muted">联网搜索</span>
              </div>
              <div className="grid gap-3 p-3 lg:grid-cols-2">
                <label className="flex min-h-10 items-center gap-2 rounded-lg bg-white/70 px-3 text-sm font-medium text-slate-700">
                  <input
                    checked={settingsForm.webSearchEnabled}
                    className="size-4 accent-[color:var(--claude-accent)]"
                    onChange={(event) =>
                      setSettingsForm((current) => ({
                        ...current,
                        webSearchEnabled: event.target.checked
                      }))
                    }
                    type="checkbox"
                  />
                  允许用户联网搜索
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium ios-muted">来源数量</span>
                  <input
                    className="ios-input w-full"
                    max={8}
                    min={1}
                    onChange={(event) =>
                      setSettingsForm((current) => ({
                        ...current,
                        webSearchMaxResults: Number(event.target.value)
                      }))
                    }
                    type="number"
                    value={settingsForm.webSearchMaxResults}
                  />
                </label>
                <div className="rounded-lg bg-stone-50 px-3 py-2 text-xs leading-5 text-stone-600 lg:col-span-2">
                  开启后，用户可在聊天输入框为单次消息打开联网搜索；后端通过 DuckDuckGo 搜索并把来源卡片随消息保存，前端用户浏览器不会直接访问搜索引擎。
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 lg:col-span-5">
              <label className="flex h-10 items-center gap-2 rounded-lg bg-white/70 px-3 text-sm font-medium text-slate-700">
                <input
                  checked={settingsForm.mockResponses}
                  className="size-4 accent-[color:var(--claude-accent)]"
                  onChange={(event) =>
                    setSettingsForm((current) => ({
                      ...current,
                      mockResponses: event.target.checked
                    }))
                  }
                  type="checkbox"
                />
                Mock 模式
              </label>
              <label className="flex h-10 items-center gap-2 rounded-lg bg-white/70 px-3 text-sm font-medium text-slate-700">
                <input
                  checked={settingsForm.clearApiKey}
                  className="size-4 accent-red-500"
                  onChange={(event) =>
                    setSettingsForm((current) => ({
                      ...current,
                      clearApiKey: event.target.checked,
                      apiKey: event.target.checked ? "" : current.apiKey
                    }))
                  }
                  type="checkbox"
                />
                清空 Key
              </label>
            </div>
            <button
              className="ios-button-primary app-action-button flex items-center justify-center gap-2 px-3 disabled:opacity-50"
              disabled={savingSettings}
              type="submit"
            >
              {savingSettings ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
              保存
            </button>
            <div className="ios-list lg:col-span-6">
              <div className="ios-cell flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="text-xs font-semibold ios-muted">模型映射</span>
                <button
                  className="ios-button-secondary app-action-button flex h-8 items-center gap-2 px-3 text-xs disabled:opacity-50"
                  disabled={refreshingModels}
                  onClick={refreshUpstreamModels}
                  type="button"
                >
                  {refreshingModels ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3.5" />
                  )}
                  刷新上游模型
                </button>
              </div>
              <div className="grid gap-3 p-3 md:grid-cols-2">
                {CHAT_MODELS.map((item) => (
                  <label className="block" key={item.id}>
                    <span className="mb-1 block text-xs font-medium ios-muted">
                      {item.label} 发给上游的模型 ID
                    </span>
                    <input
                      className="ios-input w-full"
                      onChange={(event) =>
                        setSettingsForm((current) => ({
                          ...current,
                          chatModelMap: {
                            ...current.chatModelMap,
                            [item.id]: event.target.value
                          }
                        }))
                      }
                      placeholder={DEFAULT_UPSTREAM_MODEL_MAP[item.id]}
                      value={settingsForm.chatModelMap[item.id] || ""}
                    />
                  </label>
                ))}
                <label className="block">
                  <span className="mb-1 block text-xs font-medium ios-muted">
                    image2 发给上游的模型 ID
                  </span>
                  <input
                    className="ios-input w-full"
                    onChange={(event) =>
                      setSettingsForm((current) => ({
                        ...current,
                        imageModelId: event.target.value
                      }))
                    }
                    placeholder={DEFAULT_IMAGE_UPSTREAM_MODEL}
                    value={settingsForm.imageModelId}
                  />
                </label>
              </div>
            </div>
            <div className="ios-list lg:col-span-6">
              <div className="ios-cell px-3 py-2 text-xs font-semibold ios-muted">
                启用模型
              </div>
              <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
                {(settings?.chatModels ?? []).map((item) => (
                  <ModelToggle
                    checked={settingsForm.enabledChatModelIds.includes(item.id)}
                    key={item.id}
                    model={item}
                    onChange={(checked) =>
                      setSettingsForm((current) => ({
                        ...current,
                        enabledChatModelIds: checked
                          ? [...new Set([...current.enabledChatModelIds, item.id])]
                          : current.enabledChatModelIds.filter((id) => id !== item.id)
                      }))
                    }
                  />
                ))}
              </div>
            </div>
          </form>
        </section>

        <section className="ios-panel motion-lift mb-5 p-4">
          <div className="mb-4 flex items-center gap-2">
            <div className="grid size-9 place-items-center rounded-lg bg-green-50 text-green-600">
              <Plus className="size-4" />
            </div>
            <h2 className="text-base font-semibold">创建用户</h2>
          </div>
          <form className="grid gap-3 lg:grid-cols-6" onSubmit={createUser}>
            <input
              className="ios-input lg:col-span-2"
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              placeholder="邮箱"
              required
              type="email"
              value={form.email}
            />
            <input
              className="ios-input"
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="姓名"
              type="text"
              value={form.name}
            />
            <input
              className="ios-input"
              onChange={(event) =>
                setForm((current) => ({ ...current, password: event.target.value }))
              }
              placeholder="初始密码"
              required
              type="password"
              value={form.password}
            />
            <select
              className="ios-select"
              onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as Role }))}
              value={form.role}
            >
              <option value="USER">用户</option>
              <option value="ADMIN">管理员</option>
            </select>
            <CostLimitInput
              className="ios-input"
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  monthlyCostLimitCents: value
                }))
              }
              placeholder="费用额度（美元）"
              value={form.monthlyCostLimitCents}
            />
            <button className="ios-button-primary app-action-button flex items-center justify-center gap-2 px-3" type="submit">
              <Plus className="size-4" />
              创建
            </button>
          </form>
        </section>

        <section className="ios-panel motion-lift overflow-hidden">
          <div className="flex items-center justify-between border-b border-[color:var(--ios-separator)] px-4 py-3">
            <h2 className="text-base font-semibold">用户与额度</h2>
            <button className="ios-icon-button app-action-button" onClick={loadAll} title="刷新" type="button">
              <RefreshCw className="size-4" />
            </button>
          </div>

          {loading ? (
            <div className="app-loading-pulse grid min-h-64 place-items-center text-slate-500">
              <Loader2 className="size-6 animate-spin" />
            </div>
          ) : (
            <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                <thead className="bg-white/50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">用户</th>
                    <th className="px-4 py-3 font-semibold">角色</th>
                    <th className="px-4 py-3 font-semibold">状态</th>
                    <th className="px-4 py-3 font-semibold">费用额度</th>
                    <th className="px-4 py-3 font-semibold">本月用量</th>
                    <th className="px-4 py-3 font-semibold">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--ios-separator)]">
                  {users.map((user) => (
                    <tr key={user.id} className="app-table-row align-top">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="grid size-9 place-items-center rounded-lg bg-white/80 text-[color:var(--claude-accent)]">
                            <UserRound className="size-4" />
                          </div>
                          <div className="min-w-0">
                            <input
                              className="ios-input h-9 w-40 text-sm"
                              onChange={(event) => patchUser(user.id, { name: event.target.value })}
                              value={user.name}
                            />
                            <p className="mt-1 truncate text-xs ios-muted">{user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          className="ios-select h-9 text-sm"
                          onChange={(event) =>
                            patchUser(user.id, { role: event.target.value as Role })
                          }
                          value={user.role}
                        >
                          <option value="USER">用户</option>
                          <option value="ADMIN">管理员</option>
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          className={`app-action-button flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-semibold ${
                            user.active
                              ? "bg-green-50 text-green-700"
                              : "bg-slate-100 text-slate-500"
                          }`}
                          onClick={() => patchUser(user.id, { active: !user.active })}
                          type="button"
                        >
                          {user.active ? <Check className="size-4" /> : <X className="size-4" />}
                          {user.active ? "启用" : "停用"}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <CostLimitInput
                          onChange={(value) =>
                            patchUser(user.id, { monthlyCostLimitCents: value })
                          }
                          value={user.monthlyCostLimitCents}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-1 text-xs ios-muted">
                          <p>
                            费用 {formatCents(user.usage.costUsedCents)} /{" "}
                            {formatCents(user.monthlyCostLimitCents)}
                          </p>
                          <p>消息 {formatNumber(user.usage.messagesUsed)} 条</p>
                          <p>Token {formatNumber(user.usage.tokensUsed)}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            className="ios-icon-button app-action-button disabled:opacity-50"
                            disabled={savingId === user.id}
                            onClick={() => saveUser(user)}
                            title="保存"
                            type="button"
                          >
                            {savingId === user.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Save className="size-4" />
                            )}
                          </button>
                          <button
                            className="ios-icon-button app-action-button disabled:opacity-50"
                            disabled={savingId === user.id}
                            onClick={() => resetQuota(user.id)}
                            title="重置额度"
                            type="button"
                          >
                            <RefreshCw className="size-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 p-3 md:hidden">
              {users.map((user) => (
                <div
                  className="app-list-row rounded-lg border border-[color:var(--ios-separator)] bg-white/55 p-3"
                  key={user.id}
                >
                  <div className="mb-3 flex items-start gap-3">
                    <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/80 text-[color:var(--claude-accent)]">
                      <UserRound className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <input
                        className="ios-input h-9 w-full text-sm"
                        onChange={(event) => patchUser(user.id, { name: event.target.value })}
                        value={user.name}
                      />
                      <p className="mt-1 truncate text-xs ios-muted">{user.email}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium ios-muted">角色</span>
                      <select
                        className="ios-select h-9 w-full text-sm"
                        onChange={(event) =>
                          patchUser(user.id, { role: event.target.value as Role })
                        }
                        value={user.role}
                      >
                        <option value="USER">用户</option>
                        <option value="ADMIN">管理员</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium ios-muted">状态</span>
                      <button
                        className={`app-action-button flex h-9 w-full items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold ${
                          user.active
                            ? "bg-green-50 text-green-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                        onClick={() => patchUser(user.id, { active: !user.active })}
                        type="button"
                      >
                        {user.active ? <Check className="size-4" /> : <X className="size-4" />}
                        {user.active ? "启用" : "停用"}
                      </button>
                    </label>
                    <label className="block col-span-2">
                      <span className="mb-1 block text-xs font-medium ios-muted">费用额度（美元）</span>
                      <CostLimitInput
                        className="ios-input h-9 w-full text-sm"
                        onChange={(value) =>
                          patchUser(user.id, { monthlyCostLimitCents: value })
                        }
                        value={user.monthlyCostLimitCents}
                      />
                    </label>
                  </div>

                  <div className="mt-3 rounded-lg bg-white/60 px-3 py-2 text-xs ios-muted">
                    <p>
                      费用 {formatCents(user.usage.costUsedCents)} /{" "}
                      {formatCents(user.monthlyCostLimitCents)}
                    </p>
                    <p className="mt-1">消息 {formatNumber(user.usage.messagesUsed)} 条</p>
                    <p className="mt-1">Token {formatNumber(user.usage.tokensUsed)}</p>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      className="ios-button-secondary app-action-button flex h-10 items-center justify-center gap-2 text-sm disabled:opacity-50"
                      disabled={savingId === user.id}
                      onClick={() => saveUser(user)}
                      type="button"
                    >
                      {savingId === user.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Save className="size-4" />
                      )}
                      保存
                    </button>
                    <button
                      className="ios-button-secondary app-action-button flex h-10 items-center justify-center gap-2 text-sm disabled:opacity-50"
                      disabled={savingId === user.id}
                      onClick={() => resetQuota(user.id)}
                      type="button"
                    >
                      <RefreshCw className="size-4" />
                      重置额度
                    </button>
                  </div>
                </div>
              ))}
            </div>
            </>
          )}
        </section>
        </div>
      </div>
    </main>
  );
}

function ModelToggle({
  checked,
  model,
  onChange
}: {
  checked: boolean;
  model: ChatModelView;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="app-list-row flex min-h-14 w-full min-w-0 items-start gap-3 rounded-lg bg-white/70 px-3 py-2 text-sm">
      <input
        checked={checked}
        className="mt-1 size-4 accent-[color:var(--claude-accent)]"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-slate-800">{model.label}</span>
        <span className="mt-0.5 block truncate text-xs ios-muted">
          {model.upstreamId} · {model.source === "upstream" ? "上游" : model.contextNote}
        </span>
        <span className="mt-1 block truncate text-[11px] ios-muted">
          上下文 {formatNumber(model.contextWindowTokens)} · 输入 {formatCents(model.inputCentsPerMillionTokens)}/百万 · 缓存{" "}
          {formatCents(model.cachedInputCentsPerMillionTokens)}/百万 · 输出{" "}
          {formatCents(model.outputCentsPerMillionTokens)}/百万
        </span>
      </span>
    </label>
  );
}

function DiagnosticsPanel({ result }: { result: DiagnosticsResult }) {
  const tone = {
    ok: "border-green-200 bg-green-50 text-green-800",
    warn: "border-amber-200 bg-amber-50 text-amber-800",
    error: "border-red-200 bg-red-50 text-red-700"
  } satisfies Record<DiagnosticCheck["status"], string>;

  return (
    <section className="ios-panel motion-lift mb-4 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Sub2API 连接诊断</h2>
          <p className="mt-1 text-xs ios-muted">
            {result.modelCount} 个模型 · {result.chatModelCount} 个聊天候选
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            result.ok ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
          }`}
        >
          {result.ok ? "可用" : "需检查"}
        </span>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {result.checks.map((check) => (
          <div className={`app-list-row rounded-lg border px-3 py-2 text-sm ${tone[check.status]}`} key={check.name}>
            <p className="font-semibold">{check.name}</p>
            <p className="mt-1 text-xs leading-5">{check.message}</p>
          </div>
        ))}
      </div>
      {result.sample.length > 0 ? (
        <p className="mt-3 break-words text-xs ios-muted">样例模型：{result.sample.join(", ")}</p>
      ) : null}
    </section>
  );
}

function CostLimitInput({
  className = "ios-input h-9 w-32 text-sm",
  onChange,
  placeholder,
  value
}: {
  className?: string;
  onChange: (value: number) => void;
  placeholder?: string;
  value: number;
}) {
  return (
    <input
      className={className}
      min={0.01}
      onChange={(event) => {
        const dollars = Number(event.target.value);

        if (!Number.isFinite(dollars)) {
          return;
        }

        onChange(Math.max(1, Math.round(dollars * 100)));
      }}
      placeholder={placeholder}
      step={0.01}
      type="number"
      value={value / 100}
    />
  );
}

function Banner({ children, tone }: { children: ReactNode; tone: "error" | "success" }) {
  const classes =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-700"
      : "border-green-200 bg-green-50 text-green-800";

  return <div className={`app-inline-alert mb-4 rounded-lg border px-3 py-2 text-sm ${classes}`}>{children}</div>;
}
