import { FormEvent } from "react";
import {
  Check,
  History,
  KeyRound,
  Laptop,
  Loader2,
  Lock,
  LogOut,
  MailCheck,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  XCircle
} from "lucide-react";
import type { AuthEventView, UserSessionView, UserView } from "@/types/gateway";

type SecurityTabProps = {
  currentPassword: string;
  events: AuthEventView[];
  loadingSecurity: boolean;
  newPassword: string;
  onRefreshSecurity: () => void;
  onRevokeOtherSessions: () => void;
  onRevokeSession: (sessionId: string) => void;
  onSavePassword: (event: FormEvent<HTMLFormElement>) => void;
  savingPassword: boolean;
  savingSessionId: string | null;
  sessions: UserSessionView[];
  setCurrentPassword: (password: string) => void;
  setNewPassword: (password: string) => void;
  user: UserView;
};

function formatDateTime(value?: string | null) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit"
  });
}

function eventLabel(type: string) {
  const labels: Record<string, string> = {
    account_deactivated: "账号停用",
    account_deleted: "账号删除",
    admin_user_created: "管理员创建",
    admin_user_deactivated: "管理员停用",
    admin_user_deleted: "管理员删除",
    admin_user_updated: "管理员更新",
    login: "登录",
    logout: "退出登录",
    password_changed: "修改密码",
    password_reset_completed: "重置密码",
    password_reset_requested: "发送重置邮件",
    register: "注册",
    session_revoked: "撤销设备",
    sessions_revoked: "退出其他设备"
  };

  return labels[type] || type;
}

export function SecurityTab({
  currentPassword,
  events,
  loadingSecurity,
  newPassword,
  onRefreshSecurity,
  onRevokeOtherSessions,
  onRevokeSession,
  onSavePassword,
  savingPassword,
  savingSessionId,
  sessions,
  setCurrentPassword,
  setNewPassword,
  user
}: SecurityTabProps) {
  const activeSessions = sessions.filter((session) => session.active);
  const currentSession = sessions.find((session) => session.current);
  const lastEvent = events[0];

  return (
    <div className="grid gap-4">
      <section className="ios-panel motion-lift overflow-hidden">
        <div className="grid gap-3 p-4 md:grid-cols-3">
          <div className="rounded-lg bg-white/55 px-3 py-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-stone-400">
              <ShieldCheck className="size-4" />
              账号状态
            </div>
            <p className="text-base font-semibold text-stone-950">
              {user.active ? "账号可用" : "账号已停用"}
            </p>
            <p className="mt-1 text-xs ios-muted">
              {user.role === "ADMIN" ? "管理员账号" : "普通账号"} · {user.userGroup === "VIP" ? "VIP" : "普通"}
            </p>
          </div>
          <div className="rounded-lg bg-white/55 px-3 py-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-stone-400">
              <MailCheck className="size-4" />
              邮箱
            </div>
            <p className="text-base font-semibold text-stone-950">
              {user.emailVerified ? "已验证" : "未验证"}
            </p>
            <p className="mt-1 truncate text-xs ios-muted">{user.email}</p>
          </div>
          <div className="rounded-lg bg-white/55 px-3 py-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-stone-400">
              <Laptop className="size-4" />
              登录设备
            </div>
            <p className="text-base font-semibold text-stone-950">
              {activeSessions.length || (user.sessionId ? 1 : 0)} 个活跃
            </p>
            <p className="mt-1 text-xs ios-muted">
              最近活动 {formatDateTime(currentSession?.lastSeenAt || lastEvent?.createdAt)}
            </p>
          </div>
        </div>
      </section>

      <form className="ios-panel motion-lift p-4" onSubmit={onSavePassword}>
        <div className="mb-4 flex items-center gap-2">
          <div className="grid size-9 place-items-center rounded-lg bg-[color:var(--app-accent-soft)] text-[color:var(--claude-accent)]">
            <Lock className="size-4" />
          </div>
          <div>
            <h2 className="text-base font-semibold">修改密码</h2>
            <p className="mt-1 text-xs ios-muted">保存后其他已登录设备会自动退出。</p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="block">
            <span className="mb-1 block text-xs font-medium ios-muted">当前密码</span>
            <input
              className="ios-input h-10 w-full"
              onChange={(event) => setCurrentPassword(event.target.value)}
              type="password"
              value={currentPassword}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium ios-muted">新密码</span>
            <input
              className="ios-input h-10 w-full"
              minLength={8}
              onChange={(event) => setNewPassword(event.target.value)}
              type="password"
              value={newPassword}
            />
          </label>
          <button
            className="ios-button-primary app-action-button flex h-10 items-center justify-center gap-2 px-4 disabled:opacity-60"
            disabled={savingPassword}
            type="submit"
          >
            {savingPassword ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
            更新密码
          </button>
        </div>
      </form>

      <section className="ios-panel motion-lift overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--ios-separator)] px-4 py-4">
          <div className="flex items-center gap-2">
            <Laptop className="size-4 text-[color:var(--claude-accent)]" />
            <div>
              <h2 className="text-base font-semibold">登录设备</h2>
              <p className="mt-1 text-xs ios-muted">撤销后对应浏览器需要重新登录。</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="ios-button-secondary app-action-button flex h-9 items-center gap-2 px-3 text-sm disabled:opacity-60"
              disabled={loadingSecurity}
              onClick={onRefreshSecurity}
              type="button"
            >
              <RefreshCw className="size-4" />
              刷新
            </button>
            <button
              className="ios-button-secondary app-action-button flex h-9 items-center gap-2 px-3 text-sm text-red-600 disabled:opacity-60"
              disabled={loadingSecurity || activeSessions.length <= 1 || savingSessionId === "__others__"}
              onClick={onRevokeOtherSessions}
              type="button"
            >
              {savingSessionId === "__others__" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <LogOut className="size-4" />
              )}
              退出其他设备
            </button>
          </div>
        </div>
        <div className="grid gap-2 p-4">
          {loadingSecurity ? (
            <div className="grid min-h-24 place-items-center text-stone-500">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="rounded-lg bg-white/45 px-3 py-8 text-center text-sm ios-muted">
              暂无登录设备记录。下一次登录后这里会显示设备。
            </div>
          ) : (
            sessions.map((session) => (
              <div
                className={`grid gap-3 rounded-lg border p-3 md:grid-cols-[1fr_auto] ${
                  session.current
                    ? "border-[color:var(--claude-accent)] bg-white/75"
                    : "border-[color:var(--ios-separator)] bg-white/55"
                }`}
                key={session.id}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-stone-950">{session.deviceLabel}</p>
                    {session.current ? (
                      <span className="rounded-full bg-[color:var(--app-accent-soft)] px-2 py-0.5 text-xs font-semibold text-[color:var(--claude-accent)]">
                        当前设备
                      </span>
                    ) : null}
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        session.active ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {session.active ? "活跃" : "已退出"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs ios-muted">
                    最近活动 {formatDateTime(session.lastSeenAt)} · 登录 {formatDateTime(session.createdAt)}
                  </p>
                  <p className="mt-1 truncate text-xs ios-muted">{session.userAgent || "未记录浏览器信息"}</p>
                </div>
                <button
                  className="ios-button-secondary app-action-button flex h-9 items-center justify-center gap-2 px-3 text-sm text-red-600 disabled:opacity-50"
                  disabled={!session.active || savingSessionId === session.id}
                  onClick={() => onRevokeSession(session.id)}
                  type="button"
                >
                  {savingSessionId === session.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : session.current ? (
                    <ShieldOff className="size-4" />
                  ) : (
                    <LogOut className="size-4" />
                  )}
                  {session.current ? "退出当前设备" : "撤销"}
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="ios-panel motion-lift overflow-hidden">
        <div className="flex items-center gap-2 border-b border-[color:var(--ios-separator)] px-4 py-4">
          <History className="size-4 text-[color:var(--claude-accent)]" />
          <div>
            <h2 className="text-base font-semibold">最近账号活动</h2>
            <p className="mt-1 text-xs ios-muted">记录账号动作和设备信息，便于核对异常登录。</p>
          </div>
        </div>
        <div className="grid gap-2 p-4">
          {loadingSecurity ? (
            <div className="grid min-h-24 place-items-center text-stone-500">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : events.length === 0 ? (
            <div className="rounded-lg bg-white/45 px-3 py-8 text-center text-sm ios-muted">
              暂无账号活动记录。
            </div>
          ) : (
            events.map((event) => (
              <div
                className="grid gap-2 rounded-lg border border-[color:var(--ios-separator)] bg-white/55 px-3 py-2 text-sm sm:grid-cols-[1fr_auto]"
                key={event.id}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {event.success ? (
                      <Check className="size-4 shrink-0 text-green-600" />
                    ) : (
                      <XCircle className="size-4 shrink-0 text-red-600" />
                    )}
                    <p className="truncate font-semibold text-stone-950">
                      {eventLabel(event.type)}
                    </p>
                  </div>
                  <p className="mt-1 text-xs ios-muted">{event.message || event.email}</p>
                </div>
                <div className="text-xs ios-muted sm:text-right">
                  <p>{formatDateTime(event.createdAt)}</p>
                  <p className="mt-1">{event.deviceLabel}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
