import { FormEvent } from "react";
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
  Laptop
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
  const handleSettingsUpdate = (patch: Partial<SettingsForm>) => {
    setSettingsForm((current) => ({ ...current, ...patch }));
  };

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

      <section className="ios-panel motion-lift overflow-hidden">
        <div className="flex items-center justify-between border-b border-[color:var(--ios-separator)] px-4 py-3">
          <h2 className="text-base font-semibold">用户与额度</h2>
          <button className="ios-icon-button app-action-button" onClick={onLoadAll} title="刷新" type="button">
            <RefreshCw className="size-4" />
          </button>
        </div>

        {loading ? (
          <div className="app-loading-pulse grid min-h-64 place-items-center text-slate-500">
            <Loader2 className="size-6 animate-spin" />
          </div>
        ) : (
          <>
            <div className="hidden gap-2 p-3 lg:grid">
              <div className="grid grid-cols-[minmax(220px,1fr)_minmax(210px,0.9fr)_minmax(300px,1.2fr)_minmax(220px,0.8fr)] gap-3 px-3 text-xs font-semibold text-slate-500">
                <span>用户</span>
                <span>权限与状态</span>
                <span>额度与周期</span>
                <span>本周期</span>
              </div>
              {users.map((user) => (
                <div
                  className="app-list-row grid grid-cols-[minmax(220px,1fr)_minmax(210px,0.9fr)_minmax(300px,1.2fr)_minmax(220px,0.8fr)] items-start gap-3 rounded-lg border border-[color:var(--ios-separator)] bg-white/55 p-3 text-sm"
                  key={user.id}
                >
                  <div className="flex min-w-0 items-start gap-3">
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

                  <div className="grid min-w-0 gap-2">
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        className="ios-select h-9 min-w-0 text-sm"
                        onChange={(event) =>
                          patchUser(user.id, { role: event.target.value as Role })
                        }
                        value={user.role}
                      >
                        <option value="USER">用户</option>
                        <option value="ADMIN">管理员</option>
                      </select>
                      <select
                        className="ios-select h-9 min-w-0 text-sm"
                        onChange={(event) =>
                          patchUser(user.id, { userGroup: event.target.value as UserGroup })
                        }
                        value={user.userGroup}
                      >
                        <option value="NORMAL">普通</option>
                        <option value="VIP">VIP</option>
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        className={`app-action-button flex h-9 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-semibold whitespace-nowrap ${
                          user.active
                            ? "bg-green-50 text-green-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                        onClick={() => patchUser(user.id, { active: !user.active })}
                        type="button"
                      >
                        {user.active ? <Check className="size-4 shrink-0" /> : <X className="size-4 shrink-0" />}
                        {user.active ? "启用" : "停用"}
                      </button>
                      <button
                        className={`app-action-button flex h-9 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-semibold whitespace-nowrap ${
                          user.emailVerified
                            ? "bg-green-50 text-green-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                        onClick={() => patchUser(user.id, { emailVerified: !user.emailVerified })}
                        type="button"
                        title={user.role === "ADMIN" ? "管理员可登录；验证状态用于普通登录限制。" : undefined}
                      >
                        {user.emailVerified ? <Check className="size-4 shrink-0" /> : <Mail className="size-4 shrink-0" />}
                        {user.emailVerified ? "已验证" : "未验证"}
                      </button>
                    </div>
                    <div className="rounded-lg bg-white/65 px-3 py-2 text-xs leading-5 ios-muted">
                      <p className="flex items-center gap-1.5 font-semibold text-stone-800">
                        <Laptop className="size-3.5" />
                        活跃设备 {user.activeSessionCount}
                      </p>
                      <p>最近活动 {formatOptionalDate(user.lastSeenAt)}</p>
                      <p>最近登录 {formatOptionalDate(user.lastLoginAt)}</p>
                    </div>
                  </div>

                  <div className="grid min-w-0 grid-cols-2 gap-2">
                    <label className="min-w-0">
                      <span className="mb-1 block text-[11px] font-medium ios-muted">AI 点数</span>
                      <CostLimitInput
                        className="ios-input h-9 w-full text-sm"
                        onChange={(value) =>
                          patchUser(user.id, { aiPointsBalanceCents: value })
                        }
                        value={user.aiPointsBalanceCents}
                      />
                    </label>
                    <label className="min-w-0">
                      <span className="mb-1 block text-[11px] font-medium ios-muted">月订阅</span>
                      <CostLimitInput
                        className="ios-input h-9 w-full text-sm"
                        onChange={(value) =>
                          patchUser(user.id, { monthlyCostLimitCents: value })
                        }
                        value={user.monthlyCostLimitCents}
                      />
                    </label>
                    <label className="col-span-2 min-w-0">
                      <span className="mb-1 flex items-center gap-1.5 text-[11px] font-medium ios-muted">
                        <CalendarClock className="size-3.5" />
                        下次刷新
                      </span>
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

                  <div className="grid min-w-0 gap-2">
                    <div className="rounded-lg bg-white/65 px-3 py-2 text-xs leading-5 ios-muted">
                      <p className="font-semibold text-stone-800">可用 {formatCents(user.usage.remainingCostCents)}</p>
                      <p>订阅 {formatCents(user.usage.subscriptionCostUsedCents)} / {formatCents(user.monthlyCostLimitCents)}</p>
                      <p>点数消费 {formatCents(user.usage.aiPointsCostUsedCents)}</p>
                      <p>{formatNumber(user.usage.messagesUsed)} 条 · {formatNumber(user.usage.tokensUsed)} tokens</p>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        className="ios-icon-button app-action-button disabled:opacity-50"
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
                        className="ios-icon-button app-action-button disabled:opacity-50"
                        disabled={savingId === user.id}
                        onClick={() => onResetQuota(user.id)}
                        title="开启下一订阅周期"
                        type="button"
                      >
                        <RefreshCw className="size-4" />
                      </button>
                      <button
                        className="ios-icon-button app-action-button text-red-600 disabled:opacity-40"
                        disabled={savingId === user.id || user.id === currentUser.id}
                        onClick={() => onSetDeleteUserTarget(user)}
                        title={user.id === currentUser.id ? "不能删除当前账号" : "删除用户"}
                        type="button"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="grid gap-3 p-3 lg:hidden">
              {users.map((user) => (
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
