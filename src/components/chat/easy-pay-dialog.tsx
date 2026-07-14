"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Code2, CreditCard, ExternalLink, Loader2, X } from "lucide-react";
import type { PublicPaymentSettingsView, EasyPayMethod } from "@/types/gateway";
import { formatCents } from "@/lib/format";
import {
  calculateTieredPaymentBalanceCents,
  normalizePaymentAmountTiers
} from "@/lib/payment-amount-tiers";
import { PAYMENT_METHOD_LABELS } from "./types";

function formatPaymentYuan(amountCents: number) {
  return `¥${(amountCents / 100).toFixed(2)}`;
}

type EasyPayDialogProps = {
  codingPlanId?: string | null;
  mode?: "ai_points" | "coding_plan";
  onClose: () => void;
  onOrderCreated?: () => void | Promise<void>;
  open: boolean;
  paymentSettings: PublicPaymentSettingsView;
};

export function EasyPayDialog({
  codingPlanId,
  mode = "ai_points",
  onClose,
  onOrderCreated,
  open,
  paymentSettings
}: EasyPayDialogProps) {
  const isCodingPlan = mode === "coding_plan";
  const matchedCodingPlan = paymentSettings.codingPlans.find((plan) => plan.id === codingPlanId);
  const codingPlan = matchedCodingPlan ?? {
    description: "",
    enabled: false,
    id: "",
    monthlyCostLimitCents: 0,
    name: "",
    personalApiEnabled: false,
    priceCents: 0
  };
  const [amountCents, setAmountCents] = useState(1000);
  const [method, setMethod] = useState<EasyPayMethod>(
    paymentSettings.easyPayMethods[0] ?? "alipay"
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const paymentTiers = useMemo(
    () =>
      normalizePaymentAmountTiers(
        paymentSettings.easyPayAmountTiers,
        paymentSettings.easyPayBalanceCentsPerYuan
      ),
    [paymentSettings.easyPayAmountTiers, paymentSettings.easyPayBalanceCentsPerYuan]
  );
  const balanceCents = calculateTieredPaymentBalanceCents(
    amountCents,
    paymentSettings.easyPayBalanceCentsPerYuan,
    paymentTiers
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!paymentSettings.easyPayMethods.includes(method)) {
      setMethod(paymentSettings.easyPayMethods[0] ?? "alipay");
    }
  }, [method, paymentSettings.easyPayMethods]);

  if (!mounted || !open || (isCodingPlan && !matchedCodingPlan)) {
    return null;
  }

  async function startPayment() {
    setLoading(true);
    setError("");

    const popupWindow =
      paymentSettings.easyPayDisplayMode === "popup"
        ? window.open("about:blank", "easypay", "width=520,height=760")
        : null;

    if (popupWindow) {
      popupWindow.opener = null;
    }

    let response: Response;

    try {
      response = await fetch("/api/payments/easypay/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amountCents: isCodingPlan ? undefined : amountCents,
          codingPlanId: isCodingPlan ? codingPlan.id : undefined,
          method,
          productType: isCodingPlan ? "coding_plan" : "ai_points"
        })
      });
    } catch {
      setError("网络异常，创建支付订单失败。");
      setLoading(false);
      popupWindow?.close();
      return;
    }

    const payload = (await response.json().catch(() => null)) as
      | { error?: string; paymentUrl?: string }
      | null;

    if (!response.ok || !payload?.paymentUrl) {
      setError(payload?.error || "创建支付订单失败。");
      setLoading(false);
      popupWindow?.close();
      return;
    }

    await onOrderCreated?.();

    if (popupWindow) {
      popupWindow.location.href = payload.paymentUrl;
      setLoading(false);
      return;
    }

    window.location.assign(payload.paymentUrl);
  }

  return createPortal(
    <div className="fixed inset-0 z-[90] grid place-items-center bg-stone-950/28 px-4 backdrop-blur-sm">
      <section className="app-reveal w-full max-w-md overflow-hidden rounded-2xl border border-white/55 bg-[color:var(--app-surface-solid)] p-4 text-stone-950 shadow-[0_24px_90px_rgba(18,42,35,0.28)]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="grid size-9 place-items-center rounded-lg bg-stone-100 text-[color:var(--claude-accent)]">
              {isCodingPlan ? <Code2 className="size-4" /> : <CreditCard className="size-4" />}
            </div>
            <div>
              <h2 className="text-base font-semibold">
                {isCodingPlan ? codingPlan.name : "充值 AI 点数"}
              </h2>
              <p className="mt-0.5 text-xs ios-muted">
                {isCodingPlan ? "支付后开通或顺延一个月，不自动续费" : "支付完成后异步通知到账"}
              </p>
            </div>
          </div>
          <button
            className="app-action-button grid size-8 shrink-0 place-items-center rounded-lg text-stone-400 transition hover:bg-white/70 hover:text-stone-900"
            onClick={onClose}
            title="关闭"
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="grid gap-3">
          {isCodingPlan ? (
            <div className="rounded-lg border border-[color:var(--app-border)] bg-white/60 px-3 py-3 text-sm text-stone-700">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold text-stone-950">{formatPaymentYuan(codingPlan.priceCents)} / 月</span>
                <span>月额度 {formatCents(codingPlan.monthlyCostLimitCents)}</span>
              </div>
              <p className="mt-2 text-xs ios-muted">{codingPlan.description}</p>
              {codingPlan.personalApiEnabled ? (
                <p className="mt-2 text-xs font-medium text-[color:var(--claude-accent)]">
                  套餐有效期内可创建并使用个人 API Key。
                </p>
              ) : null}
            </div>
          ) : (
            <>
              <div>
                <p className="mb-2 text-xs font-medium ios-muted">付款金额</p>
                <div className="grid grid-cols-3 gap-2">
                  {paymentTiers.map((tier) => (
                    <button
                      className={`app-action-button flex min-h-12 flex-col items-center justify-center rounded-lg border text-sm font-semibold ${
                        amountCents === tier.amountCents
                          ? "border-[color:var(--claude-accent)] bg-white text-stone-950"
                          : "border-[color:var(--ios-separator)] bg-white/60 text-stone-600"
                      }`}
                      key={tier.amountCents}
                      onClick={() => setAmountCents(tier.amountCents)}
                      type="button"
                    >
                      <span>{formatPaymentYuan(tier.amountCents)}</span>
                      <span className="mt-0.5 text-[11px] font-medium ios-muted">
                        到账 {formatCents(tier.balanceCents)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-medium ios-muted">自定义付款金额</span>
                <input
                  className="ios-input w-full"
                  min={1}
                  onChange={(event) => {
                    const value = Number(event.target.value);

                    if (Number.isFinite(value)) {
                      setAmountCents(Math.max(100, Math.round(value * 100)));
                    }
                  }}
                  step={0.01}
                  type="number"
                  value={amountCents / 100}
                />
              </label>
              <div className="rounded-lg border border-[color:var(--app-border)] bg-white/60 px-3 py-2 text-sm text-stone-700">
                支付 {formatPaymentYuan(amountCents)}，到账 {formatCents(balanceCents)} AI 点数
              </div>
            </>
          )}
          <div>
            <p className="mb-2 text-xs font-medium ios-muted">支付方式</p>
            <div className="grid grid-cols-2 gap-2">
              {paymentSettings.easyPayMethods.map((item) => (
                <button
                  className={`app-action-button h-10 rounded-lg border text-sm font-semibold ${
                    method === item
                      ? "border-[color:var(--claude-accent)] bg-white text-stone-950"
                      : "border-[color:var(--ios-separator)] bg-white/60 text-stone-600"
                  }`}
                  key={item}
                  onClick={() => setMethod(item)}
                  type="button"
                >
                  {PAYMENT_METHOD_LABELS[item]}
                </button>
              ))}
            </div>
          </div>
          {error ? (
            <div className="app-inline-alert rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}
          <button
            className="ios-button-primary app-action-button flex h-11 items-center justify-center gap-2 px-4 disabled:opacity-60"
            disabled={loading || !paymentSettings.easyPayEnabled || (isCodingPlan && !codingPlan.enabled)}
            onClick={startPayment}
            type="button"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}
            {paymentSettings.easyPayDisplayMode === "popup"
              ? "打开支付窗口"
              : isCodingPlan
                ? "订阅套餐"
                : "去支付"}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}
