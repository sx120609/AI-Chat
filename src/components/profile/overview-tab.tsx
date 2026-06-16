import { FormEvent } from "react";
import { Loader2, Save, UserRound } from "lucide-react";
import type { UserView, UsageSummary } from "@/types/gateway";
import { formatCents, formatNumber } from "@/lib/format";
import { groupLabel } from "./components";

type OverviewTabProps = {
  user: UserView;
  name: string;
  setName: (name: string) => void;
  initialUsage: UsageSummary;
  savingProfile: boolean;
  onSaveProfile: (event: FormEvent<HTMLFormElement>) => void;
};

export function OverviewTab({
  user,
  name,
  setName,
  initialUsage,
  savingProfile,
  onSaveProfile
}: OverviewTabProps) {
  return (
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
        <form className="ios-panel motion-lift p-4" onSubmit={onSaveProfile}>
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
  );
}
