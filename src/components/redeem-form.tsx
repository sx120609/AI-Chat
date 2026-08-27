"use client";

import { FormEvent, useState } from "react";
import { CheckCircle2, Gift, Loader2, TicketCheck } from "lucide-react";
import { formatCents } from "@/lib/format";
import type { RedemptionRewardView } from "@/types/gateway";

type RedeemResponse = {
  codingPlanExpiresAt?: string | null;
  error?: string;
  label?: string;
  reward?: RedemptionRewardView;
};

export function RedeemForm({ initialCode = "" }: { initialCode?: string }) {
  const [code, setCode] = useState(initialCode);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RedeemResponse | null>(null);

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);

    let response: Response;

    try {
      response = await fetch("/api/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code })
      });
    } catch {
      setError("网络异常，兑换失败，请稍后重试。");
      setLoading(false);
      return;
    }

    const payload = (await response.json().catch(() => null)) as RedeemResponse | null;

    if (!response.ok || !payload?.reward) {
      setError(payload?.error || "兑换失败，请检查兑换码后重试。");
      setLoading(false);
      return;
    }

    setResult(payload);
    setLoading(false);
  }

  if (result?.reward) {
    const reward = result.reward;
    const benefit = reward.rewardType === "CODING_PLAN"
      ? `${reward.codingPlan.name}（${reward.codingPlan.durationMonths} 个月）`
      : `${formatCents(reward.aiPointsBalanceCents)} AI 点数`;

    return (
      <div className="text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-green-50 text-green-700">
          <CheckCircle2 className="size-6" />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-stone-950">兑换成功</h1>
        <p className="mt-2 text-sm leading-6 ios-muted">
          已到账：{benefit}
          {result.codingPlanExpiresAt
            ? `，有效期至 ${new Date(result.codingPlanExpiresAt).toLocaleString("zh-CN")}`
            : ""}
          。
        </p>
        {result.label ? (
          <p className="mt-2 rounded-lg bg-white/65 px-3 py-2 text-xs ios-muted">{result.label}</p>
        ) : null}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <a
            className="ios-button-secondary app-action-button flex h-10 items-center justify-center px-3 text-sm"
            href="/chat"
          >
            返回聊天
          </a>
          <a
            className="ios-button-primary app-action-button flex h-10 items-center justify-center px-3 text-sm"
            href="/profile"
          >
            查看权益
          </a>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={redeem}>
      <div className="mb-5 flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-[color:var(--app-accent-soft)] text-[color:var(--claude-accent)]">
          <Gift className="size-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-stone-950">兑换权益</h1>
          <p className="mt-1 text-sm leading-6 ios-muted">兑换 AI 点数或 Coding Plan 套餐。</p>
        </div>
      </div>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium ios-muted">兑换码</span>
        <div className="relative">
          <TicketCheck className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
          <input
            autoCapitalize="characters"
            autoComplete="one-time-code"
            autoFocus={!initialCode}
            className="ios-input h-11 w-full pl-10 font-mono tracking-wide uppercase"
            maxLength={80}
            onChange={(event) => setCode(event.target.value)}
            placeholder="LOWIQ-XXXX-XXXX-XXXX"
            spellCheck={false}
            value={code}
          />
        </div>
      </label>
      <p className="mt-2 text-xs leading-5 ios-muted">
        兑换后权益立即到账；同一个账号不能重复使用同一兑换码。
      </p>
      {error ? (
        <div className="app-inline-alert mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      <button
        className="ios-button-primary app-action-button mt-5 flex h-11 w-full items-center justify-center gap-2 px-4 disabled:opacity-60"
        disabled={loading || code.trim().length < 8}
        type="submit"
      >
        {loading ? <Loader2 className="size-4 animate-spin" /> : <TicketCheck className="size-4" />}
        确认兑换
      </button>
    </form>
  );
}
