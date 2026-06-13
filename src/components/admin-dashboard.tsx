"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Check,
  Code2,
  CreditCard,
  Globe2,
  KeyRound,
  Loader2,
  Mail,
  MessageSquareText,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  SlidersHorizontal,
  Trash2,
  UserCog,
  UserRound,
  X
} from "lucide-react";
import { SiteConfirmDialog, SiteNoticeDialog } from "@/components/site-dialog";
import { SiteLogo } from "@/components/site-logo";
import { formatCents, formatNumber } from "@/lib/format";
import {
  CHAT_MODELS,
  DEFAULT_CONTEXT_COMPRESSION_ENABLED,
  DEFAULT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT,
  DEFAULT_IMAGE_UPSTREAM_MODEL,
  DEFAULT_LONG_CONTEXT_THRESHOLD_TOKENS,
  DEFAULT_REASONING_EFFORT,
  DEFAULT_REASONING_PARAM_MODE,
  DEFAULT_UPSTREAM_MODEL_MAP,
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
  ChatModelDisplayConfig,
  ChatModelView,
  EasyPayDisplayMode,
  EasyPayMethod,
  ReasoningEffort,
  ReasoningParamMode,
  Role,
  SystemPromptMode,
  UserGroup,
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
  userGroup: UserGroup;
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
  chatModelDisplay: Record<string, ChatModelDisplayConfig>;
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
  registrationEnabled: boolean;
  registrationRequireEmailVerification: boolean;
  registrationDefaultCostLimitCents: number;
  smtpEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
  smtpPassword: string;
  clearSmtpPassword: boolean;
  smtpFromEmail: string;
  smtpFromName: string;
  smtpSecure: boolean;
  smtpStartTls: boolean;
  easyPayEnabled: boolean;
  easyPayAllowRefund: boolean;
  easyPayDisplayMode: EasyPayDisplayMode;
  easyPayMethods: EasyPayMethod[];
  easyPayBalanceCentsPerYuan: number;
  easyPayPid: string;
  easyPayKey: string;
  clearEasyPayKey: boolean;
  easyPayApiBaseUrl: string;
  easyPayAlipayChannelId: string;
  easyPayWxpayChannelId: string;
};

type AdminTab = "access" | "models" | "prompts" | "tools" | "mail" | "payment" | "users";

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
  userGroup: "NORMAL",
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
  chatModelDisplay: {},
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
  webSearchMaxResults: 5,
  registrationEnabled: false,
  registrationRequireEmailVerification: false,
  registrationDefaultCostLimitCents: 5000,
  smtpEnabled: false,
  smtpHost: "",
  smtpPort: 587,
  smtpUsername: "",
  smtpPassword: "",
  clearSmtpPassword: false,
  smtpFromEmail: "",
  smtpFromName: "",
  smtpSecure: false,
  smtpStartTls: true,
  easyPayEnabled: false,
  easyPayAllowRefund: false,
  easyPayDisplayMode: "qrcode",
  easyPayMethods: ["alipay", "wxpay"],
  easyPayBalanceCentsPerYuan: 100,
  easyPayPid: "",
  easyPayKey: "",
  clearEasyPayKey: false,
  easyPayApiBaseUrl: "",
  easyPayAlipayChannelId: "",
  easyPayWxpayChannelId: ""
};

const adminTabs: Array<{
  id: AdminTab;
  label: string;
  description: string;
  icon: typeof Settings2;
}> = [
  {
    id: "access",
    label: "接入",
    description: "站点、API、推理与上下文",
    icon: Globe2
  },
  {
    id: "models",
    label: "模型",
    description: "映射、展示与启用",
    icon: SlidersHorizontal
  },
  {
    id: "prompts",
    label: "提示词",
    description: "全局和模型专属身份",
    icon: MessageSquareText
  },
  {
    id: "tools",
    label: "工具",
    description: "代码配置与联网搜索",
    icon: Code2
  },
  {
    id: "mail",
    label: "邮件",
    description: "SMTP、STARTTLS 与测试",
    icon: Mail
  },
  {
    id: "payment",
    label: "支付",
    description: "易支付与充值",
    icon: CreditCard
  },
  {
    id: "users",
    label: "用户",
    description: "注册、余额与账号",
    icon: UserCog
  }
];

export function AdminDashboard({ currentUser }: AdminDashboardProps) {
  const [users, setUsers] = useState<AdminUserView[]>([]);
  const [settings, setSettings] = useState<AiSettingsView | null>(null);
  const [settingsForm, setSettingsForm] = useState<SettingsForm>(emptySettings);
  const [form, setForm] = useState<CreateForm>(emptyForm);
  const [activeTab, setActiveTab] = useState<AdminTab>("access");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deleteUserTarget, setDeleteUserTarget] = useState<AdminUserView | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [testingSettings, setTestingSettings] = useState(false);
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [testEmail, setTestEmail] = useState(currentUser.email);
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
      chatModelDisplay: nextSettings.chatModelDisplay,
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
      webSearchMaxResults: nextSettings.webSearchMaxResults,
      registrationEnabled: nextSettings.registrationEnabled,
      registrationRequireEmailVerification: nextSettings.registrationRequireEmailVerification,
      registrationDefaultCostLimitCents: nextSettings.registrationDefaultCostLimitCents,
      smtpEnabled: nextSettings.smtpEnabled,
      smtpHost: nextSettings.smtpHost,
      smtpPort: nextSettings.smtpPort,
      smtpUsername: nextSettings.smtpUsername,
      smtpPassword: "",
      clearSmtpPassword: false,
      smtpFromEmail: nextSettings.smtpFromEmail,
      smtpFromName: nextSettings.smtpFromName,
      smtpSecure: nextSettings.smtpSecure,
      smtpStartTls: nextSettings.smtpStartTls,
      easyPayEnabled: nextSettings.easyPayEnabled,
      easyPayAllowRefund: nextSettings.easyPayAllowRefund,
      easyPayDisplayMode: nextSettings.easyPayDisplayMode,
      easyPayMethods: nextSettings.easyPayMethods,
      easyPayBalanceCentsPerYuan: nextSettings.easyPayBalanceCentsPerYuan,
      easyPayPid: nextSettings.easyPayPid,
      easyPayKey: "",
      clearEasyPayKey: false,
      easyPayApiBaseUrl: nextSettings.easyPayApiBaseUrl,
      easyPayAlipayChannelId: nextSettings.easyPayAlipayChannelId,
      easyPayWxpayChannelId: nextSettings.easyPayWxpayChannelId
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

  async function testSmtp() {
    setTestingSmtp(true);
    setError("");
    setNotice("");

    const response = await fetch("/api/admin/settings/smtp/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: testEmail })
    });
    const payload = (await response.json().catch(() => null)) as
      | { error?: string; message?: string }
      | null;

    if (!response.ok) {
      setError(payload?.error || "发送测试邮件失败。");
    } else {
      setNotice(payload?.message || "测试邮件已发送。");
    }

    setTestingSmtp(false);
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
        userGroup: user.userGroup,
        active: user.active,
        emailVerified: user.emailVerified,
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
      setNotice("累计消费已清空。");
      await loadUsers();
    }

    setSavingId(null);
  }

  async function deleteUser() {
    if (!deleteUserTarget) {
      return;
    }

    const target = deleteUserTarget;
    setSavingId(target.id);
    setError("");
    setNotice("");

    const response = await fetch(`/api/admin/users/${target.id}`, {
      method: "DELETE"
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    if (!response.ok) {
      setError(payload?.error || "删除用户失败。");
    } else {
      setUsers((current) => current.filter((user) => user.id !== target.id));
      setNotice(`用户 ${target.email} 已删除。`);
      setDeleteUserTarget(null);
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
  const activeTabMeta = adminTabs.find((tab) => tab.id === activeTab) ?? adminTabs[0];
  const ActiveTabIcon = activeTabMeta.icon;

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
        {diagnostics ? <DiagnosticsPanel result={diagnostics} /> : null}

        <nav className="ios-panel motion-lift mb-5 grid gap-2 p-2 sm:grid-cols-2 lg:grid-cols-7">
          {adminTabs.map((tab) => {
            const TabIcon = tab.icon;
            const selected = activeTab === tab.id;

            return (
              <button
                className={`app-action-button flex min-h-14 items-center gap-3 rounded-lg px-3 py-2 text-left transition ${
                  selected
                    ? "bg-white text-stone-950 shadow-sm"
                    : "text-stone-600 hover:bg-white/60"
                }`}
                data-testid={`admin-tab-${tab.id}`}
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

        {activeTab !== "users" ? (
        <section className="ios-panel motion-lift mb-5 p-4">
          <div className="mb-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <div className="grid size-9 place-items-center rounded-lg bg-[color:var(--app-accent-soft)] text-[color:var(--claude-accent)]">
                <ActiveTabIcon className="size-4" />
              </div>
              <div>
                <h2 className="text-base font-semibold">{activeTabMeta.label}</h2>
                <p className="text-xs ios-muted">
                  {activeTabMeta.description}
                </p>
              </div>
            </div>
            <div className="flex w-full gap-2 sm:w-auto">
              {activeTab === "access" ? (
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
              ) : null}
              {activeTab === "models" ? (
                <button
                  className="ios-button-secondary app-action-button flex h-9 flex-1 items-center justify-center gap-2 px-3 text-sm disabled:opacity-50 sm:flex-none"
                  disabled={refreshingModels}
                  onClick={refreshUpstreamModels}
                  type="button"
                >
                  {refreshingModels ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                  刷新模型
                </button>
              ) : null}
              {activeTab === "mail" ? (
                <button
                  className="ios-button-secondary app-action-button flex h-9 flex-1 items-center justify-center gap-2 px-3 text-sm disabled:opacity-50 sm:flex-none"
                  disabled={testingSmtp}
                  onClick={testSmtp}
                  type="button"
                >
                  {testingSmtp ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Mail className="size-4" />
                  )}
                  测试邮件
                </button>
              ) : null}
              <button className="ios-icon-button app-action-button shrink-0" onClick={loadAll} title="刷新" type="button">
                <RefreshCw className="size-4" />
              </button>
            </div>
          </div>

          <form autoComplete="off" className="grid gap-3 lg:grid-cols-6" onSubmit={saveSettings}>
            {activeTab === "access" ? (
              <>
                <div className="ios-list lg:col-span-6">
                  <div className="ios-cell px-3 py-2">
                    <p className="text-xs font-semibold ios-muted">
                      Key 已隐藏保存：{settings?.hasApiKey ? settings.apiKeyPreview : "未设置"}
                    </p>
                  </div>
                  <div className="grid gap-3 p-3 lg:grid-cols-6">
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-xs font-medium ios-muted">站点名称</span>
                      <input
                        autoComplete="organization"
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
                        autoComplete="off"
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
                        autoComplete="off"
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
                        autoComplete="new-password"
                        className="ios-input w-full"
                        name="admin-upstream-api-key"
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
                        autoComplete="off"
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
                    <label className="block lg:col-span-2">
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
                    <label className="block lg:col-span-2">
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
                    </label>
                    <label className="admin-check-row">
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
                    <label className="admin-check-row">
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
                    <label className="admin-check-row">
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
                </div>
              </>
            ) : null}

            {activeTab === "models" ? (
              <>
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
                    模型展示
                  </div>
                  <div className="grid gap-3 p-3">
                    {(settings?.chatModels ?? []).map((item) => {
                      const display = settingsForm.chatModelDisplay[item.id] || {};

                      return (
                        <div className="rounded-lg bg-white/70 p-3" key={item.id}>
                          <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
                            <span className="truncate text-xs font-semibold text-slate-700">
                              {item.id}
                            </span>
                            <span className="shrink-0 text-[11px] ios-muted">
                              {item.source === "upstream" ? "上游" : "内置"}
                            </span>
                          </div>
                          <div className="grid gap-2 md:grid-cols-2">
                            <label className="block">
                              <span className="mb-1 block text-xs font-medium ios-muted">显示名称</span>
                              <input
                                className="ios-input w-full"
                                onChange={(event) =>
                                  setSettingsForm((current) => ({
                                    ...current,
                                    chatModelDisplay: {
                                      ...current.chatModelDisplay,
                                      [item.id]: {
                                        ...current.chatModelDisplay[item.id],
                                        label: event.target.value
                                      }
                                    }
                                  }))
                                }
                                placeholder={item.label}
                                value={display.label || ""}
                              />
                            </label>
                            <label className="block">
                              <span className="mb-1 block text-xs font-medium ios-muted">描述</span>
                              <input
                                className="ios-input w-full"
                                onChange={(event) =>
                                  setSettingsForm((current) => ({
                                    ...current,
                                    chatModelDisplay: {
                                      ...current.chatModelDisplay,
                                      [item.id]: {
                                        ...current.chatModelDisplay[item.id],
                                        contextNote: event.target.value
                                      }
                                    }
                                  }))
                                }
                                placeholder={item.contextNote}
                                value={display.contextNote || ""}
                              />
                            </label>
                          </div>
                        </div>
                      );
                    })}
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
              </>
            ) : null}

            {activeTab === "prompts" ? (
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
                    <div className="admin-note lg:col-span-2">
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
            ) : null}

            {activeTab === "tools" ? (
              <>
                <div className="ios-list lg:col-span-6">
                  <div className="ios-cell flex items-center gap-2 px-3 py-2">
                    <Code2 className="size-4 text-[color:var(--claude-accent)]" />
                    <span className="text-xs font-semibold ios-muted">代码解释器沙箱</span>
                  </div>
                  <div className="grid gap-3 p-3 lg:grid-cols-3">
                    <label className="admin-check-row">
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
                      保留代码解释器配置
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
                    <label className="admin-check-row">
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
                    <div className="admin-note">
                      当前聊天不会自动调用代码解释器；附件会直接交给主模型，必要时仅使用内置文本解析作为兜底。
                    </div>
                  </div>
                </div>
                <div className="ios-list lg:col-span-6">
                  <div className="ios-cell flex items-center gap-2 px-3 py-2">
                    <Globe2 className="size-4 text-[color:var(--claude-accent)]" />
                    <span className="text-xs font-semibold ios-muted">联网搜索</span>
                  </div>
                  <div className="grid gap-3 p-3 lg:grid-cols-2">
                    <label className="admin-check-row">
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
                    <div className="admin-note lg:col-span-2">
                      开启后，用户可在聊天输入框为单次消息打开联网搜索；后端通过 DuckDuckGo 搜索并把来源卡片随消息保存，前端用户浏览器不会直接访问搜索引擎。
                    </div>
                  </div>
                </div>
              </>
            ) : null}

            {activeTab === "mail" ? (
              <div className="ios-list lg:col-span-6">
                <div className="ios-cell flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="text-xs font-semibold ios-muted">
                    SMTP 密码：{settings?.smtpHasPassword ? settings.smtpPasswordPreview : "未设置"}
                  </span>
                  <button
                    className="ios-button-secondary app-action-button flex h-8 items-center gap-2 px-3 text-xs disabled:opacity-50"
                    disabled={testingSmtp}
                    onClick={testSmtp}
                    type="button"
                  >
                    {testingSmtp ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />}
                    发送测试邮件
                  </button>
                </div>
                <div className="grid gap-3 p-3 lg:grid-cols-6">
                  <label className="admin-check-row">
                    <input
                      checked={settingsForm.smtpEnabled}
                      className="size-4 accent-[color:var(--claude-accent)]"
                      onChange={(event) =>
                        setSettingsForm((current) => ({
                          ...current,
                          smtpEnabled: event.target.checked
                        }))
                      }
                      type="checkbox"
                    />
                    启用邮件服务
                  </label>
                  <label className="block lg:col-span-3">
                    <span className="mb-1 block text-xs font-medium ios-muted">SMTP 主机</span>
                    <input
                      className="ios-input w-full"
                      onChange={(event) =>
                        setSettingsForm((current) => ({ ...current, smtpHost: event.target.value }))
                      }
                      placeholder="smtp.example.com"
                      value={settingsForm.smtpHost}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium ios-muted">端口</span>
                    <input
                      className="ios-input w-full"
                      max={65535}
                      min={1}
                      onChange={(event) =>
                        setSettingsForm((current) => ({ ...current, smtpPort: Number(event.target.value) }))
                      }
                      type="number"
                      value={settingsForm.smtpPort}
                    />
                  </label>
                  <label className="block lg:col-span-2">
                    <span className="mb-1 block text-xs font-medium ios-muted">账号</span>
                    <input
                      autoComplete="off"
                      className="ios-input w-full"
                      name="admin-smtp-username"
                      onChange={(event) =>
                        setSettingsForm((current) => ({ ...current, smtpUsername: event.target.value }))
                      }
                      value={settingsForm.smtpUsername}
                    />
                  </label>
                  <label className="block lg:col-span-2">
                    <span className="mb-1 block text-xs font-medium ios-muted">密码</span>
                    <input
                      autoComplete="new-password"
                      className="ios-input w-full"
                      name="admin-smtp-password"
                      onChange={(event) =>
                        setSettingsForm((current) => ({
                          ...current,
                          smtpPassword: event.target.value,
                          clearSmtpPassword: false
                        }))
                      }
                      placeholder={settings?.smtpHasPassword ? "输入新密码后替换" : "SMTP 密码"}
                      type="password"
                      value={settingsForm.smtpPassword}
                    />
                  </label>
                  <label className="block lg:col-span-2">
                    <span className="mb-1 block text-xs font-medium ios-muted">发件邮箱</span>
                    <input
                      autoComplete="off"
                      className="ios-input w-full"
                      name="admin-smtp-from-email"
                      onChange={(event) =>
                        setSettingsForm((current) => ({ ...current, smtpFromEmail: event.target.value }))
                      }
                      placeholder="noreply@example.com"
                      type="email"
                      value={settingsForm.smtpFromEmail}
                    />
                  </label>
                  <label className="block lg:col-span-2">
                    <span className="mb-1 block text-xs font-medium ios-muted">发件名称</span>
                    <input
                      autoComplete="off"
                      className="ios-input w-full"
                      name="admin-smtp-from-name"
                      onChange={(event) =>
                        setSettingsForm((current) => ({ ...current, smtpFromName: event.target.value }))
                      }
                      placeholder={settingsForm.siteName}
                      value={settingsForm.smtpFromName}
                    />
                  </label>
                  <label className="block lg:col-span-2">
                    <span className="mb-1 block text-xs font-medium ios-muted">测试收件邮箱</span>
                    <input
                      autoComplete="off"
                      className="ios-input w-full"
                      name="admin-smtp-test-email"
                      onChange={(event) => setTestEmail(event.target.value)}
                      type="email"
                      value={testEmail}
                    />
                  </label>
                  <label className="admin-check-row">
                    <input
                      checked={settingsForm.smtpSecure}
                      className="size-4 accent-[color:var(--claude-accent)]"
                      onChange={(event) =>
                        setSettingsForm((current) => ({ ...current, smtpSecure: event.target.checked }))
                      }
                      type="checkbox"
                    />
                    SSL/TLS
                  </label>
                  <label className="admin-check-row">
                    <input
                      checked={settingsForm.smtpStartTls}
                      className="size-4 accent-[color:var(--claude-accent)]"
                      onChange={(event) =>
                        setSettingsForm((current) => ({ ...current, smtpStartTls: event.target.checked }))
                      }
                      type="checkbox"
                    />
                    STARTTLS
                  </label>
                  <label className="admin-check-row">
                    <input
                      checked={settingsForm.clearSmtpPassword}
                      className="size-4 accent-red-500"
                      onChange={(event) =>
                        setSettingsForm((current) => ({
                          ...current,
                          clearSmtpPassword: event.target.checked,
                          smtpPassword: event.target.checked ? "" : current.smtpPassword
                        }))
                      }
                      type="checkbox"
                    />
                    清空 SMTP 密码
                  </label>
                </div>
              </div>
            ) : null}

            {activeTab === "payment" ? (
              <div className="ios-list lg:col-span-6">
                <div className="ios-cell px-3 py-2">
                  <p className="text-xs font-semibold ios-muted">
                    PKey：{settings?.easyPayHasKey ? settings.easyPayKeyPreview : "未设置"}
                  </p>
                </div>
                <div className="grid gap-3 p-3 lg:grid-cols-6">
                  <label className="admin-check-row">
                    <input
                      checked={settingsForm.easyPayEnabled}
                      className="size-4 accent-[color:var(--claude-accent)]"
                      onChange={(event) =>
                        setSettingsForm((current) => ({
                          ...current,
                          easyPayEnabled: event.target.checked
                        }))
                      }
                      type="checkbox"
                    />
                    启用
                  </label>
                  <label className="admin-check-row">
                    <input
                      checked={settingsForm.easyPayAllowRefund}
                      className="size-4 accent-[color:var(--claude-accent)]"
                      onChange={(event) =>
                        setSettingsForm((current) => ({
                          ...current,
                          easyPayAllowRefund: event.target.checked
                        }))
                      }
                      type="checkbox"
                    />
                    允许退款
                  </label>
                  <div className="lg:col-span-2">
                    <span className="mb-1 block text-xs font-medium ios-muted">支付模式</span>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        ["qrcode", "二维码"],
                        ["popup", "弹窗"]
                      ].map(([value, label]) => (
                        <button
                          className={`app-action-button h-10 rounded-lg border text-sm font-semibold ${
                            settingsForm.easyPayDisplayMode === value
                              ? "border-[color:var(--claude-accent)] bg-white text-stone-950"
                              : "border-[color:var(--ios-separator)] bg-white/60 text-stone-600"
                          }`}
                          key={value}
                          onClick={() =>
                            setSettingsForm((current) => ({
                              ...current,
                              easyPayDisplayMode: value as EasyPayDisplayMode
                            }))
                          }
                          type="button"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="lg:col-span-2">
                    <span className="mb-1 block text-xs font-medium ios-muted">支持的支付方式</span>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        ["alipay", "支付宝"],
                        ["wxpay", "微信支付"]
                      ].map(([value, label]) => {
                        const method = value as EasyPayMethod;
                        const checked = settingsForm.easyPayMethods.includes(method);

                        return (
                          <button
                            className={`app-action-button h-10 rounded-lg border text-sm font-semibold ${
                              checked
                                ? "border-[color:var(--claude-accent)] bg-white text-stone-950"
                                : "border-[color:var(--ios-separator)] bg-white/60 text-stone-600"
                            }`}
                            key={value}
                            onClick={() =>
                              setSettingsForm((current) => ({
                                ...current,
                                easyPayMethods: checked
                                  ? current.easyPayMethods.filter((item) => item !== method)
                                  : [...new Set([...current.easyPayMethods, method])]
                              }))
                            }
                            type="button"
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <label className="block lg:col-span-2">
                    <span className="mb-1 block text-xs font-medium ios-muted">1 元到账余额 *</span>
                    <input
                      className="ios-input w-full"
                      min={0.01}
                      onChange={(event) => {
                        const value = Number(event.target.value);

                        if (Number.isFinite(value)) {
                          setSettingsForm((current) => ({
                            ...current,
                            easyPayBalanceCentsPerYuan: Math.max(1, Math.round(value * 100))
                          }));
                        }
                      }}
                      step={0.01}
                      type="number"
                      value={settingsForm.easyPayBalanceCentsPerYuan / 100}
                    />
                    <p className="mt-1 text-xs ios-muted">
                      ¥1.00 = {formatCents(settingsForm.easyPayBalanceCentsPerYuan)} 余额
                    </p>
                  </label>
                  <label className="block lg:col-span-2">
                    <span className="mb-1 block text-xs font-medium ios-muted">PID *</span>
                    <input
                      autoComplete="off"
                      className="ios-input w-full"
                      name="admin-easypay-pid"
                      onChange={(event) =>
                        setSettingsForm((current) => ({ ...current, easyPayPid: event.target.value }))
                      }
                      value={settingsForm.easyPayPid}
                    />
                  </label>
                  <label className="block lg:col-span-2">
                    <span className="mb-1 block text-xs font-medium ios-muted">PKey *</span>
                    <input
                      autoComplete="new-password"
                      className="ios-input w-full"
                      name="admin-easypay-pkey"
                      onChange={(event) =>
                        setSettingsForm((current) => ({
                          ...current,
                          easyPayKey: event.target.value,
                          clearEasyPayKey: false
                        }))
                      }
                      placeholder={settings?.easyPayHasKey ? "输入新 PKey 后替换" : "输入 PKey"}
                      type="password"
                      value={settingsForm.easyPayKey}
                    />
                  </label>
                  <label className="block lg:col-span-2">
                    <span className="mb-1 block text-xs font-medium ios-muted">API 基础地址 *</span>
                    <input
                      autoComplete="off"
                      className="ios-input w-full"
                      name="admin-easypay-api-base-url"
                      onChange={(event) =>
                        setSettingsForm((current) => ({
                          ...current,
                          easyPayApiBaseUrl: event.target.value
                        }))
                      }
                      placeholder="https://pay.example.com"
                      value={settingsForm.easyPayApiBaseUrl}
                    />
                  </label>
                  <label className="block lg:col-span-3">
                    <span className="mb-1 block text-xs font-medium ios-muted">支付宝渠道 ID（可选）</span>
                    <input
                      className="ios-input w-full"
                      onChange={(event) =>
                        setSettingsForm((current) => ({
                          ...current,
                          easyPayAlipayChannelId: event.target.value
                        }))
                      }
                      value={settingsForm.easyPayAlipayChannelId}
                    />
                  </label>
                  <label className="block lg:col-span-3">
                    <span className="mb-1 block text-xs font-medium ios-muted">微信渠道 ID（可选）</span>
                    <input
                      className="ios-input w-full"
                      onChange={(event) =>
                        setSettingsForm((current) => ({
                          ...current,
                          easyPayWxpayChannelId: event.target.value
                        }))
                      }
                      value={settingsForm.easyPayWxpayChannelId}
                    />
                  </label>
                  <label className="block lg:col-span-3">
                    <span className="mb-1 block text-xs font-medium ios-muted">异步通知地址 *</span>
                    <div className="flex overflow-hidden rounded-lg border border-[color:var(--app-border)] bg-white/60">
                      <span className="min-w-0 flex-1 truncate px-3 py-2 text-sm text-stone-500">
                        {settingsForm.siteUrl || "https://your-site.example"}
                      </span>
                      <span className="shrink-0 border-l border-[color:var(--ios-separator)] px-3 py-2 text-sm font-semibold text-stone-600">
                        {settings?.easyPayNotifyPath || "/api/v1/payment/webhook/easypay"}
                      </span>
                    </div>
                  </label>
                  <label className="block lg:col-span-3">
                    <span className="mb-1 block text-xs font-medium ios-muted">同步跳转地址 *</span>
                    <div className="flex overflow-hidden rounded-lg border border-[color:var(--app-border)] bg-white/60">
                      <span className="min-w-0 flex-1 truncate px-3 py-2 text-sm text-stone-500">
                        {settingsForm.siteUrl || "https://your-site.example"}
                      </span>
                      <span className="shrink-0 border-l border-[color:var(--ios-separator)] px-3 py-2 text-sm font-semibold text-stone-600">
                        {settings?.easyPayReturnPath || "/payment/result"}
                      </span>
                    </div>
                  </label>
                  <label className="admin-check-row">
                    <input
                      checked={settingsForm.clearEasyPayKey}
                      className="size-4 accent-red-500"
                      onChange={(event) =>
                        setSettingsForm((current) => ({
                          ...current,
                          clearEasyPayKey: event.target.checked,
                          easyPayKey: event.target.checked ? "" : current.easyPayKey
                        }))
                      }
                      type="checkbox"
                    />
                    清空 PKey
                  </label>
                </div>
              </div>
            ) : null}

            <div className="flex justify-end lg:col-span-6">
              <button
                className="ios-button-primary app-action-button flex h-10 items-center justify-center gap-2 px-4 disabled:opacity-50"
                disabled={savingSettings}
                type="submit"
              >
                {savingSettings ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                保存
              </button>
            </div>
          </form>


        </section>
        ) : null}

        {activeTab === "users" ? (
        <>
        <section className="ios-panel motion-lift mb-5 p-4">
          <div className="mb-4 flex items-center gap-2">
            <div className="grid size-9 place-items-center rounded-lg bg-[color:var(--app-accent-soft)] text-[color:var(--claude-accent)]">
              <UserCog className="size-4" />
            </div>
            <h2 className="text-base font-semibold">注册设置</h2>
          </div>
          <form autoComplete="off" className="grid gap-3 lg:grid-cols-6" onSubmit={saveSettings}>
            <label className="admin-check-row lg:col-span-2">
              <input
                checked={settingsForm.registrationEnabled}
                className="size-4 accent-[color:var(--claude-accent)]"
                onChange={(event) =>
                  setSettingsForm((current) => ({
                    ...current,
                    registrationEnabled: event.target.checked
                  }))
                }
                type="checkbox"
              />
              开放注册
            </label>
            <label className="admin-check-row lg:col-span-2">
              <input
                checked={settingsForm.registrationRequireEmailVerification}
                className="size-4 accent-[color:var(--claude-accent)]"
                onChange={(event) =>
                  setSettingsForm((current) => ({
                    ...current,
                    registrationRequireEmailVerification: event.target.checked
                  }))
                }
                type="checkbox"
              />
              注册后验证邮箱
            </label>
            <label className="block lg:col-span-2">
              <span className="mb-1 block text-xs font-medium ios-muted">注册默认余额（美元）</span>
              <CostLimitInput
                className="ios-input w-full"
                onChange={(value) =>
                  setSettingsForm((current) => ({
                    ...current,
                    registrationDefaultCostLimitCents: value
                  }))
                }
                value={settingsForm.registrationDefaultCostLimitCents}
              />
            </label>
            <div className="flex justify-end lg:col-span-6">
              <button
                className="ios-button-primary app-action-button flex h-10 items-center justify-center gap-2 px-4 disabled:opacity-50"
                disabled={savingSettings}
                type="submit"
              >
                {savingSettings ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                保存
              </button>
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
          <form autoComplete="off" className="grid gap-3 lg:grid-cols-6" onSubmit={createUser}>
            <input
              aria-hidden="true"
              autoComplete="username"
              className="hidden"
              name="username"
              readOnly
              tabIndex={-1}
              type="text"
              value=""
            />
            <input
              aria-hidden="true"
              autoComplete="current-password"
              className="hidden"
              name="password"
              readOnly
              tabIndex={-1}
              type="password"
              value=""
            />
            <input
              autoComplete="off"
              className="ios-input lg:col-span-2"
              name="admin-create-user-email"
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              placeholder="邮箱"
              required
              type="email"
              value={form.email}
            />
            <input
              autoComplete="off"
              className="ios-input"
              name="admin-create-user-name"
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="姓名"
              type="text"
              value={form.name}
            />
            <input
              autoComplete="new-password"
              className="ios-input"
              name="admin-create-user-password"
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
            <select
              className="ios-select"
              onChange={(event) =>
                setForm((current) => ({ ...current, userGroup: event.target.value as UserGroup }))
              }
              value={form.userGroup}
            >
              <option value="NORMAL">普通</option>
              <option value="VIP">VIP</option>
            </select>
            <CostLimitInput
              className="ios-input"
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  monthlyCostLimitCents: value
                }))
              }
              placeholder="初始余额（美元）"
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
            <h2 className="text-base font-semibold">用户与余额</h2>
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
              <table className="w-full min-w-[1120px] border-collapse text-left text-sm">
                <thead className="bg-white/50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">用户</th>
                    <th className="px-4 py-3 font-semibold">角色</th>
                    <th className="px-4 py-3 font-semibold">用户组</th>
                    <th className="px-4 py-3 font-semibold">状态</th>
                    <th className="px-4 py-3 font-semibold">验证</th>
                    <th className="px-4 py-3 font-semibold">永久余额</th>
                    <th className="px-4 py-3 font-semibold">累计消费</th>
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
                        <select
                          className="ios-select h-9 text-sm"
                          onChange={(event) =>
                            patchUser(user.id, { userGroup: event.target.value as UserGroup })
                          }
                          value={user.userGroup}
                        >
                          <option value="NORMAL">普通</option>
                          <option value="VIP">VIP</option>
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
                        <button
                          className={`app-action-button flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-semibold ${
                            user.emailVerified
                              ? "bg-green-50 text-green-700"
                              : "bg-amber-50 text-amber-700"
                          }`}
                          onClick={() => patchUser(user.id, { emailVerified: !user.emailVerified })}
                          type="button"
                          title={user.role === "ADMIN" ? "管理员可登录；验证状态用于普通登录限制。" : undefined}
                        >
                          {user.emailVerified ? <Check className="size-4" /> : <Mail className="size-4" />}
                          {user.emailVerified ? "已验证" : user.role === "ADMIN" ? "未验证 · 管理员可登录" : "未验证"}
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
                          <p>已消费 {formatCents(user.usage.costUsedCents)}</p>
                          <p>
                            余额 {formatCents(user.usage.remainingCostCents)} /{" "}
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
                            title="清空累计消费"
                            type="button"
                          >
                            <RefreshCw className="size-4" />
                          </button>
                          <button
                            className="ios-icon-button app-action-button text-red-600 disabled:opacity-40"
                            disabled={savingId === user.id || user.id === currentUser.id}
                            onClick={() => setDeleteUserTarget(user)}
                            title={user.id === currentUser.id ? "不能删除当前账号" : "删除用户"}
                            type="button"
                          >
                            <Trash2 className="size-4" />
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
                      <span className="mb-1 block text-xs font-medium ios-muted">用户组</span>
                      <select
                        className="ios-select h-9 w-full text-sm"
                        onChange={(event) =>
                          patchUser(user.id, { userGroup: event.target.value as UserGroup })
                        }
                        value={user.userGroup}
                      >
                        <option value="NORMAL">普通</option>
                        <option value="VIP">VIP</option>
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
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium ios-muted">邮箱</span>
                      <button
                        className={`app-action-button flex h-9 w-full items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold ${
                          user.emailVerified
                            ? "bg-green-50 text-green-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                        onClick={() => patchUser(user.id, { emailVerified: !user.emailVerified })}
                        type="button"
                        title={user.role === "ADMIN" ? "管理员可登录；验证状态用于普通登录限制。" : undefined}
                      >
                        {user.emailVerified ? <Check className="size-4" /> : <Mail className="size-4" />}
                        {user.emailVerified ? "已验证" : user.role === "ADMIN" ? "未验证 · 管理员可登录" : "未验证"}
                      </button>
                    </label>
                    <label className="block col-span-2">
                      <span className="mb-1 block text-xs font-medium ios-muted">永久余额（美元）</span>
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
                    <p>已消费 {formatCents(user.usage.costUsedCents)}</p>
                    <p>
                      余额 {formatCents(user.usage.remainingCostCents)} /{" "}
                      {formatCents(user.monthlyCostLimitCents)}
                    </p>
                    <p className="mt-1">消息 {formatNumber(user.usage.messagesUsed)} 条</p>
                    <p className="mt-1">Token {formatNumber(user.usage.tokensUsed)}</p>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2">
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
                      清空累计
                    </button>
                    <button
                      className="ios-button-secondary app-action-button flex h-10 items-center justify-center gap-2 text-sm text-red-600 disabled:opacity-40"
                      disabled={savingId === user.id || user.id === currentUser.id}
                      onClick={() => setDeleteUserTarget(user)}
                      type="button"
                    >
                      <Trash2 className="size-4" />
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
            </>
          )}
        </section>
        </>
        ) : null}
        </div>
      </div>
      <SiteConfirmDialog
        confirmLabel="删除用户"
        description={`确定删除 ${deleteUserTarget?.name || "这个用户"}（${
          deleteUserTarget?.email || ""
        }）吗？该用户的会话、附件、API Key、订单和用量记录都会被删除，此操作不可恢复。`}
        loading={Boolean(deleteUserTarget && savingId === deleteUserTarget.id)}
        onCancel={() => setDeleteUserTarget(null)}
        onConfirm={deleteUser}
        open={Boolean(deleteUserTarget)}
        title="删除用户"
        tone="danger"
      />
      <SiteNoticeDialog
        description={error || notice}
        onClose={() => {
          setError("");
          setNotice("");
        }}
        open={Boolean(error || notice)}
        title={error ? "操作失败" : "操作已完成"}
        tone={error ? "error" : "success"}
      />
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
