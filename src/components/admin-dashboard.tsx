"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Loader2,
  Mail,
  RefreshCw,
  Save
} from "lucide-react";
import { SiteConfirmDialog, SiteNoticeDialog } from "@/components/site-dialog";
import { SiteLogo } from "@/components/site-logo";
import { renderSystemPrompt, DEFAULT_SYSTEM_PROMPT_TEMPLATE } from "@/lib/system-prompt";
import type {
  AdminUserView,
  AiSettingsView,
  UserView,
  AdminUsageRecordView,
  AdminUsageSummaryView,
  AdminUsageFilterOptionsView
} from "@/types/gateway";

import type {
  AdminTab,
  DiagnosticsResult,
  SettingsForm,
  CreateForm,
  UsageFilterState,
  AdminUsagePayload
} from "./admin/types";

import {
  emptyForm,
  emptySettings,
  defaultUsageFilters,
  adminTabs,
  DiagnosticsPanel
} from "./admin/components";

import { AccessTab } from "./admin/access-tab";
import { ModelsTab } from "./admin/models-tab";
import { PromptsTab } from "./admin/prompts-tab";
import { ToolsTab } from "./admin/tools-tab";
import { MailTab } from "./admin/mail-tab";
import { PaymentTab } from "./admin/payment-tab";
import { UsersTab } from "./admin/users-tab";
import { UsageTab } from "./admin/usage-tab";

type AdminDashboardProps = {
  currentUser: UserView;
};

export function AdminDashboard({ currentUser }: AdminDashboardProps) {
  const [users, setUsers] = useState<AdminUserView[]>([]);
  const [usageFilters, setUsageFilters] = useState<UsageFilterState>(defaultUsageFilters);
  const usageFiltersRef = useRef<UsageFilterState>(defaultUsageFilters);
  const [usageRecords, setUsageRecords] = useState<AdminUsageRecordView[]>([]);
  const [usageSummary, setUsageSummary] = useState<AdminUsageSummaryView | null>(null);
  const [usagePageMeta, setUsagePageMeta] = useState({
    page: 1,
    pageSize: 20,
    totalPages: 1
  });
  const [usageOptions, setUsageOptions] = useState<AdminUsageFilterOptionsView>({
    apiKeys: [],
    models: [],
    users: []
  });
  const [usageGeneratedAt, setUsageGeneratedAt] = useState("");
  const [settings, setSettings] = useState<AiSettingsView | null>(null);
  const [settingsForm, _setSettingsForm] = useState<SettingsForm>(emptySettings);
  const setSettingsForm = useCallback((
    value: SettingsForm | ((current: SettingsForm) => SettingsForm | Partial<SettingsForm>)
  ) => {
    _setSettingsForm((current) => {
      if (typeof value === "function") {
        const updated = value(current);
        return { ...current, ...updated } as SettingsForm;
      }
      return value;
    });
  }, []);
  const [form, _setForm] = useState<CreateForm>(emptyForm);
  const setForm = useCallback((
    value: CreateForm | ((current: CreateForm) => CreateForm | Partial<CreateForm>)
  ) => {
    _setForm((current) => {
      if (typeof value === "function") {
        const updated = value(current);
        return { ...current, ...updated } as CreateForm;
      }
      return value;
    });
  }, []);
  const [activeTab, setActiveTab] = useState<AdminTab>("access");
  const [loading, setLoading] = useState(true);
  const [loadingUsage, setLoadingUsage] = useState(false);
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

  const loadUsage = useCallback(async (filters: UsageFilterState = usageFiltersRef.current) => {
    const params = new URLSearchParams({
      limit: filters.pageSize,
      page: filters.page,
      days: filters.days
    });

    if (filters.apiKey !== "all") {
      params.set("apiKey", filters.apiKey);
    }

    if (filters.model !== "all") {
      params.set("model", filters.model);
    }

    if (filters.surface !== "all") {
      params.set("surface", filters.surface);
    }

    if (filters.userId !== "all") {
      params.set("userId", filters.userId);
    }

    if (filters.query.trim()) {
      params.set("q", filters.query.trim());
    }

    const response = await fetch(`/api/admin/usage?${params.toString()}`);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error || "加载用量记录失败。");
    }

    const payload = (await response.json()) as AdminUsagePayload;
    setUsageRecords(payload.records);
    setUsageSummary(payload.summary);
    setUsagePageMeta({
      page: payload.page,
      pageSize: payload.pageSize,
      totalPages: payload.totalPages
    });
    setUsageOptions(payload.filterOptions);
    setUsageGeneratedAt(payload.generatedAt);
  }, []);

  const applySettings = useCallback((nextSettings: AiSettingsView) => {
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
  }, [setSettingsForm]);

  const loadSettings = useCallback(async () => {
    const response = await fetch("/api/admin/settings");

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error || "加载 API 设置失败。");
    }

    const payload = (await response.json()) as { settings: AiSettingsView };
    applySettings(payload.settings);
  }, [applySettings]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      await Promise.all([loadUsers(), loadSettings(), loadUsage()]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载失败。");
    } finally {
      setLoading(false);
    }
  }, [loadSettings, loadUsage, loadUsers]);

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

  async function refreshUsage() {
    setLoadingUsage(true);
    setError("");
    setNotice("");

    try {
      await loadUsage();
    } catch (usageError) {
      setError(usageError instanceof Error ? usageError.message : "加载用量记录失败。");
    } finally {
      setLoadingUsage(false);
    }
  }

  function updateUsageFilters(patch: Partial<UsageFilterState>) {
    setUsageFilters((current) => {
      const next = {
        ...current,
        ...patch,
        ...("page" in patch ? {} : { page: "1" })
      };

      usageFiltersRef.current = next;
      return next;
    });
  }

  async function applyUsageFilters(patch: Partial<UsageFilterState> = {}) {
    const next = {
      ...usageFiltersRef.current,
      ...patch
    };

    usageFiltersRef.current = next;
    setUsageFilters(next);
    setLoadingUsage(true);
    setError("");
    setNotice("");

    try {
      await loadUsage(next);
    } catch (usageError) {
      setError(usageError instanceof Error ? usageError.message : "加载用量记录失败。");
    } finally {
      setLoadingUsage(false);
    }
  }

  async function resetUsageFilters() {
    usageFiltersRef.current = defaultUsageFilters;
    setUsageFilters(defaultUsageFilters);
    setLoadingUsage(true);
    setError("");
    setNotice("");

    try {
      await loadUsage(defaultUsageFilters);
    } catch (usageError) {
      setError(usageError instanceof Error ? usageError.message : "加载用量记录失败。");
    } finally {
      setLoadingUsage(false);
    }
  }

  function exportUsageCsv() {
    const filters = usageFiltersRef.current;
    const params = new URLSearchParams({
      days: filters.days,
      format: "csv",
      limit: "5000"
    });

    if (filters.apiKey !== "all") {
      params.set("apiKey", filters.apiKey);
    }

    if (filters.model !== "all") {
      params.set("model", filters.model);
    }

    if (filters.surface !== "all") {
      params.set("surface", filters.surface);
    }

    if (filters.userId !== "all") {
      params.set("userId", filters.userId);
    }

    if (filters.query.trim()) {
      params.set("q", filters.query.trim());
    }

    window.location.href = `/api/admin/usage?${params.toString()}`;
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
      await Promise.all([loadUsers(), loadUsage()]);
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
      await loadUsage().catch(() => undefined);
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

          <nav className="ios-panel motion-lift mb-5 grid gap-2 p-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
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

          {activeTab === "usage" ? (
            <UsageTab
              filters={usageFilters}
              generatedAt={usageGeneratedAt}
              loading={loading || loadingUsage}
              onChangePage={(page) => void applyUsageFilters({ page: String(page) })}
              onChangePageSize={(pageSize) =>
                void applyUsageFilters({ page: "1", pageSize })
              }
              onExportCsv={exportUsageCsv}
              onRefresh={refreshUsage}
              onReset={resetUsageFilters}
              onUpdateFilters={updateUsageFilters}
              options={usageOptions}
              pageMeta={usagePageMeta}
              records={usageRecords}
              summary={usageSummary}
            />
          ) : null}

          {activeTab === "users" ? (
            <UsersTab
              currentUser={currentUser}
              settingsForm={settingsForm}
              setSettingsForm={setSettingsForm}
              savingSettings={savingSettings}
              onSaveSettings={saveSettings}
              form={form}
              setForm={setForm}
              onCreateUser={createUser}
              users={users}
              patchUser={patchUser}
              savingId={savingId}
              onSaveUser={saveUser}
              onResetQuota={resetQuota}
              onSetDeleteUserTarget={setDeleteUserTarget}
              loading={loading}
              onLoadAll={loadAll}
            />
          ) : null}

          {activeTab !== "users" && activeTab !== "usage" ? (
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
                {activeTab === "access" && (
                  <AccessTab
                    settings={settings}
                    settingsForm={settingsForm}
                    setSettingsForm={setSettingsForm}
                  />
                )}

                {activeTab === "models" && (
                  <ModelsTab
                    settings={settings}
                    settingsForm={settingsForm}
                    setSettingsForm={setSettingsForm}
                    refreshingModels={refreshingModels}
                    onRefreshUpstreamModels={refreshUpstreamModels}
                  />
                )}

                {activeTab === "prompts" && (
                  <PromptsTab
                    settings={settings}
                    settingsForm={settingsForm}
                    setSettingsForm={setSettingsForm}
                    defaultPromptPreview={defaultPromptPreview}
                  />
                )}

                {activeTab === "tools" && (
                  <ToolsTab
                    settingsForm={settingsForm}
                    setSettingsForm={setSettingsForm}
                  />
                )}

                {activeTab === "mail" && (
                  <MailTab
                    settings={settings}
                    settingsForm={settingsForm}
                    setSettingsForm={setSettingsForm}
                    testingSmtp={testingSmtp}
                    onTestSmtp={testSmtp}
                    testEmail={testEmail}
                    setTestEmail={setTestEmail}
                  />
                )}

                {activeTab === "payment" && (
                  <PaymentTab
                    settings={settings}
                    settingsForm={settingsForm}
                    setSettingsForm={setSettingsForm}
                  />
                )}

                <div className="flex justify-end lg:col-span-6">
                  <button
                    className="ios-button-primary app-action-button flex h-10 items-center justify-center gap-2 px-4 disabled:opacity-50"
                    disabled={savingSettings}
                    type="submit"
                  >
                    {savingSettings ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                    保存
                  </button>
                </div>
              </form>
            </section>
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
