"use client";

import {
  ArrowLeft,
  Check,
  Copy,
  KeyRound,
  Loader2,
  Lock,
  Plus,
  Save,
  Shield,
  Sparkles,
  Trash2,
  UserRound
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { DocumentTitle } from "@/components/document-title";
import { SiteConfirmDialog } from "@/components/site-dialog";
import { SiteLogo } from "@/components/site-logo";
import { formatCents, formatNumber } from "@/lib/format";
import type { SiteSettingsView, UsageSummary, UserApiKeyView, UserView } from "@/types/gateway";

type ProfileCenterProps = {
  initialUser: UserView;
  initialUsage: UsageSummary;
  siteSettings: SiteSettingsView;
};

type ApiKeysPayload = {
  canCreate: boolean;
  keys: UserApiKeyView[];
};

function groupLabel(group: string) {
  return group === "VIP" ? "VIP" : "普通";
}

export function ProfileCenter({ initialUser, initialUsage, siteSettings }: ProfileCenterProps) {
  const [user, setUser] = useState(initialUser);
  const [name, setName] = useState(initialUser.name);
  const [aiStylePrompt, setAiStylePrompt] = useState(initialUser.aiStylePrompt || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [apiKeyName, setApiKeyName] = useState("个人 API Key");
  const [apiKeys, setApiKeys] = useState<UserApiKeyView[]>([]);
  const [canCreateApiKey, setCanCreateApiKey] = useState(user.userGroup === "VIP");
  const [createdApiKey, setCreatedApiKey] = useState("");
  const [origin, setOrigin] = useState("");
  const [deleteKeyId, setDeleteKeyId] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [savingKeyId, setSavingKeyId] = useState<string | null>(null);
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

  useEffect(() => {
    setOrigin(window.location.origin);
    void loadApiKeys();
  }, [loadApiKeys]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingProfile(true);
    setNotice("");
    setError("");

    const response = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ aiStylePrompt, name })
    });
    const payload = (await response.json().catch(() => null)) as
      | { error?: string; user?: UserView }
      | null;

    if (!response.ok || !payload?.user) {
      setError(payload?.error || "保存个人资料失败。");
    } else {
      setUser(payload.user);
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
    setCreatedApiKey("");

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
      setCreatedApiKey(payload.apiKey);
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

  async function copyCreatedKey() {
    if (!createdApiKey) {
      return;
    }

    await navigator.clipboard?.writeText(createdApiKey);
    setNotice("API Key 已复制。");
  }

  return (
    <main className="ios-page app-shell app-route-enter min-h-dvh px-4 py-4 text-stone-950 sm:px-6">
      <DocumentTitle title={`个人中心 - ${siteSettings.siteName}`} />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <header className="app-header-center app-fade-in flex items-center justify-between gap-3 py-2">
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
        </header>

        {notice ? <div className="app-inline-alert rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</div> : null}
        {error ? <div className="app-inline-alert rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

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

        <div className="grid gap-4 lg:grid-cols-2">
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
        </div>

        <form className="ios-panel motion-lift p-4" onSubmit={saveProfile}>
          <div className="mb-4 flex items-center gap-2">
            <Sparkles className="size-4 text-[color:var(--claude-accent)]" />
            <h2 className="text-base font-semibold">AI 风格</h2>
          </div>
          <textarea
            className="ios-input min-h-36 w-full resize-y leading-6"
            maxLength={3000}
            onChange={(event) => setAiStylePrompt(event.target.value)}
            placeholder="例如：回答更简洁、偏技术细节、先给结论、使用轻松语气..."
            value={aiStylePrompt}
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs ios-muted">{aiStylePrompt.length}/3000</p>
            <button
              className="ios-button-primary app-action-button flex h-10 items-center justify-center gap-2 px-4 disabled:opacity-60"
              disabled={savingProfile}
              type="submit"
            >
              {savingProfile ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              保存风格
            </button>
          </div>
        </form>

        <section className="ios-panel motion-lift overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-[color:var(--ios-separator)] px-4 py-3">
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-[color:var(--claude-accent)]" />
              <h2 className="text-base font-semibold">个人 API</h2>
            </div>
            <span className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-semibold text-stone-600">
              {canCreateApiKey ? "VIP 可用" : "需 VIP"}
            </span>
          </div>

          <div className="grid gap-4 p-4">
            <div className="rounded-lg border border-[color:var(--app-border)] bg-white/55 px-3 py-2 text-sm text-stone-700">
              Base URL：<span className="font-semibold">{origin ? `${origin}/api/v1` : "/api/v1"}</span>
              <span className="mx-2 text-stone-300">/</span>
              兼容地址：<span className="font-semibold">{origin ? `${origin}/v1` : "/v1"}</span>
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

            {createdApiKey ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-semibold">只显示一次</p>
                <div className="mt-2 flex gap-2">
                  <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-white/80 px-2 py-2 text-xs">
                    {createdApiKey}
                  </code>
                  <button
                    className="ios-icon-button app-action-button shrink-0"
                    onClick={copyCreatedKey}
                    title="复制"
                    type="button"
                  >
                    <Copy className="size-4" />
                  </button>
                </div>
              </div>
            ) : null}

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
                    </div>
                    <div className="flex items-center gap-2">
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
    </main>
  );
}
