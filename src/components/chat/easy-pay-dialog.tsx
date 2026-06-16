"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CreditCard, ExternalLink, Loader2, X } from "lucide-react";
import type { PublicPaymentSettingsView, EasyPayMethod } from "@/types/gateway";
import { formatCents } from "@/lib/format";
import { PAYMENT_AMOUNTS_CENTS, PAYMENT_METHOD_LABELS } from "./types";

function formatPaymentYuan(amountCents: number) {
  return `¥${(amountCents / 100).toFixed(2)}`;
}

function calculatePaymentBalanceCents(amountCents: number, balanceCentsPerYuan: number) {
  const rate = Number.isFinite(balanceCentsPerYuan) ? balanceCentsPerYuan : 100;
  return Math.max(1, Math.round((Math.max(1, amountCents) * rate) / 100));
}

type EasyPayDialogProps = {
  onClose: () => void;
  open: boolean;
  paymentSettings: PublicPaymentSettingsView;
};

export function EasyPayDialog({
  onClose,
  open,
  paymentSettings
}: EasyPayDialogProps) {
  const [amountCents, setAmountCents] = useState(1000);
  const [method, setMethod] = useState<EasyPayMethod>(
    paymentSettings.easyPayMethods[0] ?? "alipay"
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const balanceCents = calculatePaymentBalanceCents(
    amountCents,
    paymentSettings.easyPayBalanceCentsPerYuan
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!paymentSettings.easyPayMethods.includes(method)) {
      setMethod(paymentSettings.easyPayMethods[0] ?? "alipay");
    }
  }, [method, paymentSettings.easyPayMethods]);

  if (!mounted || !open) {
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
          amountCents,
          method
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

    if (popupWindow) {
      popupWindow.location.href = payload.paymentUrl;
      setLoading(false);
      return;
    }

    window.location.href = payload.paymentUrl;
  }

  return createPortal(
    <div className="fixed inset-0 z-[90] grid place-items-center bg-stone-950/28 px-4 backdrop-blur-sm">
      <section className="app-reveal w-full max-w-md overflow-hidden rounded-2xl border border-white/55 bg-[color:var(--app-surface-solid)] p-4 text-stone-950 shadow-[0_24px_90px_rgba(18,42,35,0.28)]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="grid size-9 place-items-center rounded-lg bg-stone-100 text-[color:var(--claude-accent)]">
              <CreditCard className="size-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold">充值余额</h2>
              <p className="mt-0.5 text-xs ios-muted">支付完成后异步通知到账</p>
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
          <div>
            <p className="mb-2 text-xs font-medium ios-muted">付款金额</p>
            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_AMOUNTS_CENTS.map((amount) => (
                <button
                  className={`app-action-button flex min-h-12 flex-col items-center justify-center rounded-lg border text-sm font-semibold ${
                    amountCents === amount
                      ? "border-[color:var(--claude-accent)] bg-white text-stone-950"
                      : "border-[color:var(--ios-separator)] bg-white/60 text-stone-600"
                  }`}
                  key={amount}
                  onClick={() => setAmountCents(amount)}
                  type="button"
                >
                  <span>{formatPaymentYuan(amount)}</span>
                  <span className="mt-0.5 text-[11px] font-medium ios-muted">
                    到账 {formatCents(
                      calculatePaymentBalanceCents(
                        amount,
                        paymentSettings.easyPayBalanceCentsPerYuan
                      )
                    )}
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
            支付 {formatPaymentYuan(amountCents)}，到账 {formatCents(balanceCents)} 余额
          </div>
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
            disabled={loading || !paymentSettings.easyPayEnabled}
            onClick={startPayment}
            type="button"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}
            {paymentSettings.easyPayDisplayMode === "popup" ? "打开支付窗口" : "去支付"}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}
