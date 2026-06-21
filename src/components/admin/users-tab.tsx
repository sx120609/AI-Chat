import { FormEvent, useMemo, useState } from "react";
import {
  UserCog,
  Plus,
  RefreshCw,
  Loader2,
  UserRound,
  Check,
  X,
  Mail,
  Save,
  Trash2,
  CalendarClock,
  Laptop,
  Search,
  ShieldCheck,
  UsersRound,
  WalletCards
} from "lucide-react";
import { formatCents, formatNumber } from "@/lib/format";
import type {
  AdminUserView,
  Role,
  UserGroup,
  UserView
} from "@/types/gateway";
import { CostLimitInput } from "./components";
import type { SettingsForm, CreateForm } from "./types";

type StatusFilter = "all" | "active" | "disabled" | "unverified";
type RoleFilter = "all" | Role;
type GroupFilter = "all" | UserGroup;

function dateTimeLocalValue(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

function formatCycleDate(value: string) {
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

function formatOptionalDate(value?: string | null) {
  return value ? formatCycleDate(value) : "-";
}

function nextResetPatch(value: string) {
  if (!value) {
    return {};
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? {} : { quotaNextResetAt: date.toISOString() };
}

type UsersTabProps = {
  currentUser: UserView;
  settingsForm: SettingsForm;
  setSettingsForm: (
    updater: (current: SettingsForm) => SettingsForm | Partial<SettingsForm>
  ) => void;
  savingSettings: boolean;
  onSaveSettings: (event: FormEvent<HTMLFormElement>) => void;
  form: CreateForm;
  setForm: (
    updater: (current: CreateForm) => CreateForm | Partial<CreateForm>
  ) => void;
  onCreateUser: (event: FormEvent<HTMLFormElement>) => void;
  users: AdminUserView[];
  patchUser: (userId: string, patch: Partial<AdminUserView>) => void;
  savingId: string | null;
  onSaveUser: (user: AdminUserView) => void;
  onResetQuota: (userId: string) => void;
  onSetDeleteUserTarget: (user: AdminUserView) => void;
  loading: boolean;
  onLoadAll: () => void;
};

export function UsersTab({
  currentUser,
  settingsForm,
  setSettingsForm,
  savingSettings,
  onSaveSettings,
  form,
  setForm,
  onCreateUser,
  users,
  patchUser,
  savingId,
  onSaveUser,
  onResetQuota,
  onSetDeleteUserTarget,
  loading,
  onLoadAll
}: UsersTabProps) {
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("all");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const handleSettingsUpdate = (patch: Partial<SettingsForm>) => {
    setSettingsForm((current) => ({ ...current, ...patch }));
  };
  const summary = useMemo(() => {
    const active = users.filter((user) => user.active).length;
    const admins = users.filter((user) => user.role === "ADMIN").length;
    const vip = users.filter((user) => user.userGroup === "VIP").length;
    const activeSessions = users.reduce((total, user) => total + user.activeSessionCount, 0);
    const remainingCents = users.reduce(
      (total, user) => total + user.usage.remainingCostCents,
      0
    );

    return {
      active,
      activeSessions,
      admins,
      remainingCents,
      total: users.length,
      vip
    };
  }, [users]);
  const filteredUsers = useMemo(() => {
    const keyword = query.trim().toLowerCase();

    return users.filter((user) => {
      if (keyword && !`${user.name} ${user.email}`.toLowerCase().includes(keyword)) {
        return false;
      }

      if (statusFilter === "active" && !user.active) {
        return false;
      }

      if (statusFilter === "disabled" && user.active) {
        return false;
      }

      if (statusFilter === "unverified" && user.emailVerified) {
        return false;
      }

      if (roleFilter !== "all" && user.role !== roleFilter) {
        return false;
      }

      if (groupFilter !== "all" && user.userGroup !== groupFilter) {
        return false;
      }

      return true;
    });
  }, [groupFilter, query, roleFilter, statusFilter, users]);

  return (
    <>
      <section className="ios-panel motion-lift mb-5 p-4">
        <div className="mb-4 flex items-center gap-2">
          <div className="grid size-9 place-items-center rounded-lg bg-[color:var(--app-accent-soft)] text-[color:var(--claude-accent)]">
            <UserCog className="size-4" />
          </div>
          <h2 className="text-base font-semibold">注册设置</h2>
        </div>
        <form autoComplete="off" className="grid grid-cols-1 gap-3 lg:grid-cols-6" onSubmit={onSaveSettings}>
          <label className="admin-check-row lg:col-span-2">
            <input
              checked={settingsForm.registrationEnabled}
              className="size-4 accent-[color:var(--claude-accent)]"
              onChange={(event) =>
                handleSettingsUpdate({ registrationEnabled: event.target.checked })
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
                handleSettingsUpdate({ registrationRequireEmailVerification: event.target.checked })
              }
              type="checkbox"
            />
            注册后验证邮箱
          </label>
          <label className="block lg:col-span-2">
            <span className="mb-1 block text-xs font-medium ios-muted">注册默认 AI 点数（美元）</span>
            <CostLimitInput
              className="ios-input w-full"
              onChange={(value) =>
                handleSettingsUpdate({ registrationDefaultCostLimitCents: value })
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
              {savingSettings ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
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
        <form autoComplete="off" className="grid grid-cols-1 gap-3 lg:grid-cols-8" onSubmit={onCreateUser}>
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
          <label className="block">
            <span className="mb-1 block text-xs font-medium ios-muted">AI 点数（美元）</span>
            <CostLimitInput
              className="ios-input w-full"
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  aiPointsBalanceCents: value
                }))
              }
              placeholder="初始 AI 点数"
              value={form.aiPointsBalanceCents}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium ios-muted">月订阅（美元）</span>
            <CostLimitInput
              className="ios-input w-full"
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  monthlyCostLimitCents: value
                }))
              }
              placeholder="每周期额度"
              value={form.monthlyCostLimitCents}
            />
          </label>
          <button className="ios-button-primary app-action-button flex items-center justify-center gap-2 px-3" type="submit">
            <Plus className="size-4" />
            创建
          </button>
        </form>
      </section>

      <section className="ios-panel motion-lift overflow-hidden" data-testid="admin-users-section">
        <div className="grid gap-3 border-b border-[color:var(--ios-separator)] px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">用户与额度</h2>
              <p className="mt-1 text-xs ios-muted">
                显示 {filteredUsers.length} / {users.length} 个用户
              </p>
            </div>
            <button className="ios-icon-button app-action-button" onClick={onLoadAll} title="刷新" type="button">
              <RefreshCw className="size-4" />
            </button>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-[color:var(--ios-separator)] bg-white/55 px-3 py-2">
              <p className="flex items-center gap-1.5 text-xs font-semibold ios-muted">
                <UsersRound className="size-3.5" />
                总用户
              </p>
              <p className="mt-1 text-lg font-semibold text-stone-950">{summary.total}</p>
              <p className="text-xs ios-muted">启用 {summary.active} · 管理员 {summary.admins}</p>
            </div>
            <div className="rounded-lg border border-[color:var(--ios-separator)] bg-white/55 px-3 py-2">
              <p className="flex items-center gap-1.5 text-xs font-semibold ios-muted">
                <ShieldCheck className="size-3.5" />
                VIP
              </p>
              <p className="mt-1 text-lg font-semibold text-stone-950">{summary.vip}</p>
              <p className="text-xs ios-muted">个人 API 权限用户</p>
            </div>
            <div className="rounded-lg border border-[color:var(--ios-separator)] bg-white/55 px-3 py-2">
              <p className="flex items-center gap-1.5 text-xs font-semibold ios-muted">
                <Laptop className="size-3.5" />
                活跃设备
              </p>
              <p className="mt-1 text-lg font-semibold text-stone-950">{summary.activeSessions}</p>
              <p className="text-xs ios-muted">当前未退出的登录设备</p>
            </div>
            <div className="rounded-lg border border-[color:var(--ios-separator)] bg-white/55 px-3 py-2">
              <p className="flex items-center gap-1.5 text-xs font-semibold ios-muted">
                <WalletCards className="size-3.5" />
                可用余额
              </p>
              <p className="mt-1 text-lg font-semibold text-stone-950">{formatCents(summary.remainingCents)}</p>
              <p className="text-xs ios-muted">筛选前全部用户合计</p>
            </div>
          </div>

          <div className="grid gap-2 xl:grid-cols-[minmax(18rem,1fr)_auto_auto_auto]">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
              <input
                aria-label="搜索用户"
                className="ios-input h-10 w-full pl-9 text-sm"
                data-testid="admin-users-search"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索昵称或邮箱"
                value={query}
              />
            </label>
            <select
              className="ios-select h-10 text-sm"
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              value={statusFilter}
            >
              <option value="all">全部状态</option>
              <option value="active">仅启用</option>
              <option value="disabled">仅停用</option>
              <option value="unverified">未验证邮箱</option>
            </select>
            <select
              className="ios-select h-10 text-sm"
              onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}
              value={roleFilter}
            >
              <option value="all">全部角色</option>
              <option value="USER">用户</option>
              <option value="ADMIN">管理员</option>
            </select>
            <select
              className="ios-select h-10 text-sm"
              onChange={(event) => setGroupFilter(event.target.value as GroupFilter)}
              value={groupFilter}
            >
              <option value="all">全部用户组</option>
              <option value="NORMAL">普通</option>
              <option value="VIP">VIP</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="app-loading-pulse grid min-h-64 place-items-center text-slate-500">
            <Loader2 className="size-6 animate-spin" />
          </div>
        ) : (
          <>
            <div className="hidden p-3 lg:block" data-testid="admin-users-desktop-list">
              <div className="overflow-x-auto rounded-lg border border-[color:var(--ios-separator)] bg-white/45">
                <div className="min-w-[1180px]">
                  <div className="grid grid-cols-[minmax(240px,1.1fr)_190px_300px_260px_130px] gap-3 border-b border-[color:var(--ios-separator)] px-3 py-2 text-xs font-semibold text-slate-500">
                    <span>用户</span>
                    <span>权限</span>
                    <span>额度</span>
                    <span>周期与活动</span>
                    <span className="text-right">操作</span>
                  </div>
                  {filteredUsers.length === 0 ? (
                    <div className="grid min-h-32 place-items-center text-sm ios-muted">
                      没有匹配的用户。
                    </div>
                  ) : (
                    filteredUsers.map((user) => (
                      <div
                        className="app-list-row grid grid-cols-[minmax(240px,1.1fr)_190px_300px_260px_130px] items-center gap-3 border-b border-[color:var(--ios-separator)] px-3 py-2 text-sm last:border-b-0"
                        key={user.id}
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/80 text-[color:var(--claude-accent)]">
                            <UserRound className="size-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <input
                              className="ios-input h-8 w-full text-sm"
                              onChange={(event) => patchUser(user.id, { name: event.target.value })}
                              value={user.name}
                            />
                            <p className="mt-1 truncate text-xs ios-muted">{user.email}</p>
                          </div>
                        </div>

                        <div className="grid min-w-0 gap-1.5">
                          <div className="grid grid-cols-2 gap-1.5">
                            <select
                              className="ios-select h-8 min-w-0 text-xs"
                              onChange={(event) =>
                                patchUser(user.id, { role: event.target.value as Role })
                              }
                              value={user.role}
                            >
                              <option value="USER">用户</option>
                              <option value="ADMIN">管理员</option>
                            </select>
                            <select
                              className="ios-select h-8 min-w-0 text-xs"
                              onChange={(event) =>
                                patchUser(user.id, { userGroup: event.target.value as UserGroup })
                              }
                              value={user.userGroup}
                            >
                              <option value="NORMAL">普通</option>
                              <option value="VIP">VIP</option>
                            </select>
                          </div>
                          <div className="grid grid-cols-2 gap-1.5">
                            <button
                              className={`app-action-button flex h-8 items-center justify-center gap-1 rounded-lg px-2 text-xs font-semibold whitespace-nowrap ${
                                user.active
                                  ? "bg-green-50 text-green-700"
                                  : "bg-slate-100 text-slate-500"
                              }`}
                              onClick={() => patchUser(user.id, { active: !user.active })}
                              type="button"
                            >
                              {user.active ? <Check className="size-3.5 shrink-0" /> : <X className="size-3.5 shrink-0" />}
                              {user.active ? "启用" : "停用"}
                            </button>
                            <button
                              className={`app-action-button flex h-8 items-center justify-center gap-1 rounded-lg px-2 text-xs font-semibold whitespace-nowrap ${
                                user.emailVerified
                                  ? "bg-green-50 text-green-700"
                                  : "bg-amber-50 text-amber-700"
                              }`}
                              onClick={() => patchUser(user.id, { emailVerified: !user.emailVerified })}
                              type="button"
                              title={user.role === "ADMIN" ? "管理员可登录；验证状态用于普通登录限制。" : undefined}
                            >
                              {user.emailVerified ? <Check className="size-3.5 shrink-0" /> : <Mail className="size-3.5 shrink-0" />}
                              {user.emailVerified ? "已验证" : "未验证"}
                            </button>
                          </div>
                        </div>

                        <div className="grid min-w-0 gap-1.5">
                          <div className="grid grid-cols-2 gap-1.5">
                            <label className="min-w-0">
                              <span className="mb-1 block text-[10px] font-medium leading-none ios-muted">AI 点数</span>
                              <CostLimitInput
                                className="ios-input h-8 w-full text-xs"
                                onChange={(value) =>
                                  patchUser(user.id, { aiPointsBalanceCents: value })
                                }
                                value={user.aiPointsBalanceCents}
                              />
                            </label>
                            <label className="min-w-0">
                              <span className="mb-1 block text-[10px] font-medium leading-none ios-muted">月订阅</span>
                              <CostLimitInput
                                className="ios-input h-8 w-full text-xs"
                                onChange={(value) =>
                                  patchUser(user.id, { monthlyCostLimitCents: value })
                                }
                                value={user.monthlyCostLimitCents}
                              />
                            </label>
                          </div>
                          <div className="grid grid-cols-2 gap-1.5 text-[11px] leading-4 ios-muted">
                            <p className="truncate">可用 {formatCents(user.usage.remainingCostCents)}</p>
                            <p className="truncate">点数用 {formatCents(user.usage.aiPointsCostUsedCents)}</p>
                            <p className="col-span-2 truncate">
                              订阅 {formatCents(user.usage.subscriptionCostUsedCents)} / {formatCents(user.monthlyCostLimitCents)}
                            </p>
                          </div>
                        </div>

                        <div className="grid min-w-0 gap-1.5">
                          <label className="min-w-0">
                            <span className="mb-1 flex items-center gap-1 text-[10px] font-medium leading-none ios-muted">
                              <CalendarClock className="size-3" />
                              下次刷新
                            </span>
                            <input
                              className="ios-input h-8 w-full text-xs"
                              onChange={(event) =>
                                patchUser(user.id, nextResetPatch(event.target.value))
                              }
                              type="datetime-local"
                              value={dateTimeLocalValue(user.quotaNextResetAt)}
                            />
                          </label>
                          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px] leading-4 ios-muted">
                            <p className="truncate">设备 {user.activeSessionCount}</p>
                            <p className="truncate">{formatNumber(user.usage.messagesUsed)} 条</p>
                            <p className="truncate">活动 {formatOptionalDate(user.lastSeenAt)}</p>
                            <p className="truncate">{formatNumber(user.usage.tokensUsed)} tokens</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-1.5 justify-self-end">
                          <button
                            className="ios-icon-button app-action-button size-9 disabled:opacity-50"
                            disabled={savingId === user.id}
                            onClick={() => onSaveUser(user)}
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
                            className="ios-icon-button app-action-button size-9 disabled:opacity-50"
                            disabled={savingId === user.id}
                            onClick={() => onResetQuota(user.id)}
                            title="开启下一订阅周期"
                            type="button"
                          >
                            <RefreshCw className="size-4" />
                          </button>
                          <button
                            className="ios-icon-button app-action-button size-9 text-red-600 disabled:opacity-40"
                            disabled={savingId === user.id || user.id === currentUser.id}
                            onClick={() => onSetDeleteUserTarget(user)}
                            title={user.id === currentUser.id ? "不能删除当前账号" : "删除用户"}
                            type="button"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
            <div className="grid gap-3 p-3 lg:hidden" data-testid="admin-users-mobile-list">
              {filteredUsers.length === 0 ? (
                <div className="grid min-h-32 place-items-center rounded-lg border border-[color:var(--ios-separator)] bg-white/55 text-sm ios-muted">
                  没有匹配的用户。
                </div>
              ) : filteredUsers.map((user) => (
                <div
                  className="app-list-row rounded-lg border border-[color:var(--ios-separator)] bg-white/55 p-3"
                  key={user.id}
                >
                  <div className="mb-3 flex items-start gap-3">
                    <div className="grid size-9 place-items-center rounded-lg bg-white/80 text-[color:var(--claude-accent)]">
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
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium ios-muted">AI 点数（美元）</span>
                      <CostLimitInput
                        className="ios-input h-9 w-full text-sm"
                        onChange={(value) =>
                          patchUser(user.id, { aiPointsBalanceCents: value })
                        }
                        value={user.aiPointsBalanceCents}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium ios-muted">月订阅（美元）</span>
                      <CostLimitInput
                        className="ios-input h-9 w-full text-sm"
                        onChange={(value) =>
                          patchUser(user.id, { monthlyCostLimitCents: value })
                        }
                        value={user.monthlyCostLimitCents}
                      />
                    </label>
                    <label className="block col-span-2">
                      <span className="mb-1 block text-xs font-medium ios-muted">下次刷新</span>
                      <input
                        className="ios-input h-9 w-full text-sm"
                        onChange={(event) =>
                          patchUser(user.id, nextResetPatch(event.target.value))
                        }
                        type="datetime-local"
                        value={dateTimeLocalValue(user.quotaNextResetAt)}
                      />
                    </label>
                  </div>

                  <div className="mt-3 rounded-lg bg-white/60 px-3 py-2 text-xs ios-muted">
                    <p>活跃设备 {user.activeSessionCount}</p>
                    <p>最近活动 {formatOptionalDate(user.lastSeenAt)}</p>
                    <p>最近登录 {formatOptionalDate(user.lastLoginAt)}</p>
                    <p>可用 {formatCents(user.usage.remainingCostCents)}</p>
                    <p>订阅已用 {formatCents(user.usage.subscriptionCostUsedCents)} / {formatCents(user.monthlyCostLimitCents)}</p>
                    <p>点数消费 {formatCents(user.usage.aiPointsCostUsedCents)}</p>
                    <p>下次刷新 {formatCycleDate(user.quotaNextResetAt)}</p>
                    <p className="mt-1">消息 {formatNumber(user.usage.messagesUsed)} 条</p>
                    <p className="mt-1">Token {formatNumber(user.usage.tokensUsed)}</p>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <button
                      className="ios-button-secondary app-action-button flex h-10 items-center justify-center gap-2 text-sm disabled:opacity-50"
                      disabled={savingId === user.id}
                      onClick={() => onSaveUser(user)}
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
                      onClick={() => onResetQuota(user.id)}
                      type="button"
                    >
                      <RefreshCw className="size-4" />
                      下一周期
                    </button>
                    <button
                      className="ios-button-secondary app-action-button flex h-10 items-center justify-center gap-2 text-sm text-red-600 disabled:opacity-40"
                      disabled={savingId === user.id || user.id === currentUser.id}
                      onClick={() => onSetDeleteUserTarget(user)}
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
  );
}
