import { FormEvent } from "react";
import {
  BadgeDollarSign,
  CheckCircle2,
  Clock3,
  Loader2,
  Mail,
  Save,
  ShieldCheck,
  UserRound
} from "lucide-react";
import type { UserView, UsageSummary } from "@/types/gateway";
import { formatCents, formatNumber, formatShortDateTime } from "@/lib/format";
import { groupLabel } from "./components";

type OverviewTabProps = {
  user: UserView;
  name: string;
  setName: (name: string) => void;
  initialUsage: UsageSummary;
  savingProfile: boolean;
  onSaveProfile: (event: FormEvent<HTMLFormElement>) => void;
};

function usagePercent(usage: UsageSummary) {
  const total = usage.monthlyCostLimitCents + usage.aiPointsCostUsedCents + usage.aiPointsBalanceCents;

  if (total <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round((usage.costUsedCents / total) * 100)));
}

export function OverviewTab({
  user,
  name,
  setName,
  initialUsage,
  savingProfile,
  onSaveProfile
}: OverviewTabProps) {
  const percent = usagePercent(initialUsage);

  return (
    <div className="grid gap-4">
      <section className="ios-panel motion-lift overflow-hidden">
        <div className="grid gap-3 p-4 lg:grid-cols-[1.2fr_0.8fr_1fr]">
          <div className="rounded-lg bg-white/60 px-4 py-4">
            <div className="mb-4 flex items-start gap-3">
              <div className="grid size-11 shrink-0 place-items-center rounded-lg bg-[color:var(--app-accent-soft)] text-[color:var(--claude-accent)]">
                <UserRound className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold text-stone-950">{user.name}</p>
                <p className="mt-1 truncate text-sm ios-muted">{user.email}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg border border-[color:var(--ios-separator)] bg-white/70 px-3 py-2">
                <p className="text-xs ios-muted">角色</p>
                <p className="mt-1 font-semibold">{user.role === "ADMIN" ? "管理员" : "用户"}</p>
              </div>
              <div className="rounded-lg border border-[color:var(--ios-separator)] bg-white/70 px-3 py-2">
                <p className="text-xs ios-muted">用户组</p>
                <p className="mt-1 font-semibold">{groupLabel(user.userGroup)}</p>
              </div>
            </div>
          </div>

          <div className="grid gap-3">
            <div className="rounded-lg bg-white/60 px-4 py-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-stone-400">
                <ShieldCheck className="size-4" />
                账号状态
              </div>
              <p className="flex items-center gap-2 text-base font-semibold text-stone-950">
                <CheckCircle2 className="size-4 text-green-600" />
                {user.active ? "可正常使用" : "已停用"}
              </p>
            </div>
            <div className="rounded-lg bg-white/60 px-4 py-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-stone-400">
                <Mail className="size-4" />
                邮箱状态
              </div>
              <p className="text-base font-semibold text-stone-950">
                {user.emailVerified ? "已验证" : "待验证"}
              </p>
            </div>
          </div>

          <div className="rounded-lg bg-white/60 px-4 py-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <BadgeDollarSign className="size-4 text-[color:var(--claude-accent)]" />
                <h2 className="text-sm font-semibold text-stone-950">额度周期</h2>
              </div>
              <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-semibold ios-muted">
                {percent}% 已用
              </span>
            </div>
            <p className="text-2xl font-semibold text-stone-950">
              {formatCents(initialUsage.remainingCostCents)}
            </p>
            <p className="mt-1 text-xs ios-muted">当前可用额度</p>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-stone-200">
              <div
                className="h-full rounded-full bg-[color:var(--claude-accent)] transition-[width]"
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="mt-3 grid gap-1 text-xs ios-muted">
              <p>订阅剩余 {formatCents(initialUsage.subscriptionRemainingCostCents)}</p>
              <p>AI 点数 {formatCents(initialUsage.aiPointsBalanceCents)}</p>
              <p>已用 {formatCents(initialUsage.costUsedCents)} · {formatNumber(initialUsage.tokensUsed)} tokens</p>
              <p className="flex items-center gap-1.5 font-medium text-stone-700">
                <Clock3 className="size-3.5" />
                下次刷新 {formatShortDateTime(initialUsage.windowEnd)}
              </p>
            </div>
          </div>
        </div>
      </section>

      <form className="ios-panel motion-lift p-4" onSubmit={onSaveProfile}>
        <div className="mb-4 flex items-center gap-2">
          <div className="grid size-9 place-items-center rounded-lg bg-[color:var(--app-accent-soft)] text-[color:var(--claude-accent)]">
            <UserRound className="size-4" />
          </div>
          <div>
            <h2 className="text-base font-semibold">个人资料</h2>
            <p className="mt-1 text-xs ios-muted">昵称会显示在个人中心和管理后台。</p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="block">
            <span className="mb-1 block text-xs font-medium ios-muted">昵称</span>
            <input
              className="ios-input h-10 w-full"
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium ios-muted">邮箱</span>
            <input className="ios-input h-10 w-full opacity-70" disabled value={user.email} />
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
  );
}
