import {
  Code2,
  CreditCard,
  Loader2,
  Plus,
  ReceiptText,
  RefreshCw,
  Trash2
} from "lucide-react";
import { useEffect, useState } from "react";
import { formatCents } from "@/lib/format";
import {
  calculateTieredPaymentBalanceCents,
  normalizePaymentAmountTiers
} from "@/lib/payment-amount-tiers";
import type {
  AiSettingsView,
  EasyPayDisplayMode,
  EasyPayMethod,
  PaymentOrderSummaryView,
  PaymentOrderView
} from "@/types/gateway";
import { formatDateTime } from "./components";
import type { SettingsForm } from "./types";

type PaymentTabProps = {
  deletingOrderId: string | null;
  loadingOrders: boolean;
  onRefreshOrders: () => void;
  onSetDeleteOrderTarget: (order: PaymentOrderView) => void;
  onSyncOrder: (orderId: string) => void;
  orders: PaymentOrderView[];
  settings: AiSettingsView | null;
  settingsForm: SettingsForm;
  setSettingsForm: (
    updater: (current: SettingsForm) => SettingsForm | Partial<SettingsForm>
  ) => void;
  summary: PaymentOrderSummaryView;
  syncingOrderId: string | null;
};

function formatPaymentYuan(amountCents: number) {
  return `¥${(amountCents / 100).toFixed(2)}`;
}

function formatCentsInputValue(value: number) {
  if (!Number.isFinite(value)) {
    return "";
  }

  return String(Math.round(value) / 100);
}

function CentsDraftInput({
  className,
  minCents,
  onChange,
  value
}: {
  className: string;
  minCents: number;
  onChange: (value: number) => void;
  value: number;
}) {
  const [draft, setDraft] = useState(() => formatCentsInputValue(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setDraft(formatCentsInputValue(value));
    }
  }, [focused, value]);

  return (
    <input
      className={className}
      min={minCents / 100}
      onBlur={() => {
        setFocused(false);
        setDraft(formatCentsInputValue(value));
      }}
      onChange={(event) => {
        const nextValue = event.target.value;
        const yuanValue = Number(nextValue);

        setDraft(nextValue);

        if (!nextValue.trim() || !Number.isFinite(yuanValue)) {
          return;
        }

        onChange(Math.max(minCents, Math.round(yuanValue * 100)));
      }}
      onFocus={() => setFocused(true)}
      step={0.01}
      type="number"
      value={draft}
    />
  );
}

function editablePaymentTiers(settingsForm: SettingsForm) {
  if (settingsForm.easyPayAmountTiers.length > 0) {
    return settingsForm.easyPayAmountTiers;
  }

  return normalizePaymentAmountTiers([], settingsForm.easyPayBalanceCentsPerYuan);
}

function paymentMethodLabel(method: string) {
  if (method === "alipay") {
    return "支付宝";
  }

  if (method === "wxpay") {
    return "微信支付";
  }

  return method || "-";
}

function paymentStatusMeta(status: string) {
  if (status === "PAID") {
    return {
      label: "已到账",
      tone: "bg-green-50 text-green-700"
    };
  }

  if (status === "PENDING") {
    return {
      label: "待支付",
      tone: "bg-amber-50 text-amber-700"
    };
  }

  if (status === "FAILED") {
    return {
      label: "失败",
      tone: "bg-red-50 text-red-700"
    };
  }

  if (status === "CLOSED") {
    return {
      label: "已关闭",
      tone: "bg-slate-100 text-slate-600"
    };
  }

  return {
    label: status || "-",
    tone: "bg-slate-100 text-slate-600"
  };
}

function paymentBenefitLabel(order: PaymentOrderView) {
  if (order.productType === "CODING_PLAN") {
    return `月额度 ${formatCents(order.codingPlanMonthlyCostLimitCents ?? 0)}`;
  }

  return `${formatCents(order.balanceCents)} AI 点数`;
}

export function PaymentTab({
  deletingOrderId,
  loadingOrders,
  onRefreshOrders,
  onSetDeleteOrderTarget,
  onSyncOrder,
  orders,
  settings,
  settingsForm,
  setSettingsForm,
  summary,
  syncingOrderId
}: PaymentTabProps) {
  const handleUpdate = (patch: Partial<SettingsForm>) => {
    setSettingsForm((current) => ({ ...current, ...patch }));
  };
  const paymentTiers = editablePaymentTiers(settingsForm);
  const highestPaymentTierAmount = Math.max(0, ...paymentTiers.map((tier) => tier.amountCents));
  const canAddPaymentTier = highestPaymentTierAmount < 100000;
  const updatePaymentTier = (
    index: number,
    patch: Partial<{ amountCents: number; balanceCents: number }>
  ) => {
    setSettingsForm((current) => {
      const tiers = editablePaymentTiers(current);

      return {
        ...current,
        easyPayAmountTiers: tiers.map((tier, tierIndex) =>
          tierIndex === index ? { ...tier, ...patch } : tier
        )
      };
    });
  };
  const addPaymentTier = () => {
    setSettingsForm((current) => {
      const tiers = editablePaymentTiers(current);
      const highestAmountCents = Math.max(0, ...tiers.map((tier) => tier.amountCents));

      if (highestAmountCents >= 100000) {
        return current;
      }

      const amountCents = Math.min(100000, highestAmountCents + 1000);

      return {
        ...current,
        easyPayAmountTiers: [
          ...tiers,
          {
            amountCents,
            balanceCents: calculateTieredPaymentBalanceCents(
              amountCents,
              current.easyPayBalanceCentsPerYuan,
              tiers
            )
          }
        ]
      };
    });
  };
  const removePaymentTier = (index: number) => {
    setSettingsForm((current) => {
      const tiers = editablePaymentTiers(current);

      if (tiers.length <= 1) {
        return current;
      }

      return {
        ...current,
        easyPayAmountTiers: tiers.filter((_, tierIndex) => tierIndex !== index)
      };
    });
  };

  return (
    <div className="grid gap-4 lg:col-span-6">
      <div className="ios-list">
        <div className="ios-cell px-3 py-2">
          <p className="text-xs font-semibold ios-muted">
            PKey：{settings?.easyPayHasKey ? settings.easyPayKeyPreview : "未设置"}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 p-3 lg:grid-cols-6">
          <label className="admin-check-row">
            <input
              checked={settingsForm.easyPayEnabled}
              className="size-4 accent-[color:var(--claude-accent)]"
              onChange={(event) => handleUpdate({ easyPayEnabled: event.target.checked })}
              type="checkbox"
            />
            启用
          </label>
          <label className="admin-check-row">
            <input
              checked={settingsForm.easyPayAllowRefund}
              className="size-4 accent-[color:var(--claude-accent)]"
              onChange={(event) => handleUpdate({ easyPayAllowRefund: event.target.checked })}
              type="checkbox"
            />
            允许退款
          </label>
          <div className="lg:col-span-2">
            <span className="mb-1 block text-xs font-medium ios-muted">支付模式</span>
            <div className="grid grid-cols-2 gap-2">
              {[
                ["qrcode", "二维码"],
                ["popup", "弹窗"]
              ].map(([value, label]) => (
                <button
                  className={`app-action-button h-10 rounded-lg border text-sm font-semibold ${
                    settingsForm.easyPayDisplayMode === value
                      ? "border-[color:var(--claude-accent)] bg-white text-stone-950"
                      : "border-[color:var(--ios-separator)] bg-white/60 text-stone-600"
                  }`}
                  key={value}
                  onClick={() =>
                    handleUpdate({ easyPayDisplayMode: value as EasyPayDisplayMode })
                  }
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="lg:col-span-2">
            <span className="mb-1 block text-xs font-medium ios-muted">支持的支付方式</span>
            <div className="grid grid-cols-2 gap-2">
              {[
                ["alipay", "支付宝"],
                ["wxpay", "微信支付"]
              ].map(([value, label]) => {
                const method = value as EasyPayMethod;
                const checked = settingsForm.easyPayMethods.includes(method);

                return (
                  <button
                    className={`app-action-button h-10 rounded-lg border text-sm font-semibold ${
                      checked
                        ? "border-[color:var(--claude-accent)] bg-white text-stone-950"
                        : "border-[color:var(--ios-separator)] bg-white/60 text-stone-600"
                    }`}
                    key={value}
                    onClick={() =>
                      setSettingsForm((current) => ({
                        ...current,
                        easyPayMethods: checked
                          ? current.easyPayMethods.filter((item) => item !== method)
                          : [...new Set([...current.easyPayMethods, method])]
                      }))
                    }
                    type="button"
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="block lg:col-span-2">
            <span className="mb-1 block text-xs font-medium ios-muted">1 元到账 AI 点数 *</span>
            <CentsDraftInput
              className="ios-input w-full"
              minCents={1}
              onChange={(easyPayBalanceCentsPerYuan) =>
                handleUpdate({ easyPayBalanceCentsPerYuan })
              }
              value={settingsForm.easyPayBalanceCentsPerYuan}
            />
            <p className="mt-1 text-xs ios-muted">
              ¥1.00 = {formatCents(settingsForm.easyPayBalanceCentsPerYuan)} AI 点数
            </p>
          </label>
          <div className="lg:col-span-4" data-testid="admin-payment-tiers">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-xs font-medium ios-muted">优惠档次</span>
              <button
                className="ios-button-secondary app-action-button flex h-8 items-center justify-center gap-1.5 px-2.5 text-xs"
                disabled={!canAddPaymentTier}
                onClick={addPaymentTier}
                type="button"
              >
                <Plus className="size-3.5" />
                新增档次
              </button>
            </div>
            <div className="grid gap-2">
              {paymentTiers.map((tier, index) => (
                <div
                  className="grid gap-2 rounded-lg border border-[color:var(--ios-separator)] bg-white/60 p-2 sm:grid-cols-[1fr_1fr_auto]"
                  key={`payment-tier-${index}`}
                >
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium ios-muted">
                      付款金额
                    </span>
                    <CentsDraftInput
                      className="ios-input h-9 w-full text-sm"
                      minCents={100}
                      onChange={(amountCents) => updatePaymentTier(index, { amountCents })}
                      value={tier.amountCents}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium ios-muted">
                      到账 AI 点数
                    </span>
                    <CentsDraftInput
                      className="ios-input h-9 w-full text-sm"
                      minCents={1}
                      onChange={(balanceCents) => updatePaymentTier(index, { balanceCents })}
                      value={tier.balanceCents}
                    />
                  </label>
                  <button
                    className="ios-icon-button app-action-button self-end text-red-600 hover:bg-red-50 sm:mb-0"
                    disabled={paymentTiers.length <= 1}
                    onClick={() => removePaymentTier(index)}
                    title="删除档次"
                    type="button"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs ios-muted">
              自定义金额会按相邻档位自动折算，超过最高档沿用最高档倍率。
            </p>
          </div>
          <label className="block lg:col-span-2">
            <span className="mb-1 block text-xs font-medium ios-muted">PID *</span>
            <input
              autoComplete="off"
              className="ios-input w-full"
              name="admin-easypay-pid"
              onChange={(event) => handleUpdate({ easyPayPid: event.target.value })}
              value={settingsForm.easyPayPid}
            />
          </label>
          <label className="block lg:col-span-2">
            <span className="mb-1 block text-xs font-medium ios-muted">PKey *</span>
            <input
              autoComplete="new-password"
              className="ios-input w-full"
              name="admin-easypay-pkey"
              onChange={(event) =>
                handleUpdate({
                  easyPayKey: event.target.value,
                  clearEasyPayKey: false
                })
              }
              placeholder={settings?.easyPayHasKey ? "输入新 PKey 后替换" : "输入 PKey"}
              type="password"
              value={settingsForm.easyPayKey}
            />
          </label>
          <label className="block lg:col-span-2">
            <span className="mb-1 block text-xs font-medium ios-muted">API 基础地址 *</span>
            <input
              autoComplete="off"
              className="ios-input w-full"
              name="admin-easypay-api-base-url"
              onChange={(event) => handleUpdate({ easyPayApiBaseUrl: event.target.value })}
              placeholder="https://pay.example.com"
              value={settingsForm.easyPayApiBaseUrl}
            />
          </label>
          <label className="block lg:col-span-3">
            <span className="mb-1 block text-xs font-medium ios-muted">支付宝渠道 ID（可选）</span>
            <input
              className="ios-input w-full"
              onChange={(event) => handleUpdate({ easyPayAlipayChannelId: event.target.value })}
              value={settingsForm.easyPayAlipayChannelId}
            />
          </label>
          <label className="block lg:col-span-3">
            <span className="mb-1 block text-xs font-medium ios-muted">微信渠道 ID（可选）</span>
            <input
              className="ios-input w-full"
              onChange={(event) => handleUpdate({ easyPayWxpayChannelId: event.target.value })}
              value={settingsForm.easyPayWxpayChannelId}
            />
          </label>
          <label className="block lg:col-span-3">
            <span className="mb-1 block text-xs font-medium ios-muted">异步通知地址 *</span>
            <div className="flex overflow-hidden rounded-lg border border-[color:var(--app-border)] bg-white/60">
              <span className="min-w-0 flex-1 truncate px-3 py-2 text-sm text-stone-500">
                {settingsForm.siteUrl || "https://your-site.example"}
              </span>
              <span className="shrink-0 border-l border-[color:var(--ios-separator)] px-3 py-2 text-sm font-semibold text-stone-600">
                {settings?.easyPayNotifyPath || "/api/v1/payment/webhook/easypay"}
              </span>
            </div>
          </label>
          <label className="block lg:col-span-3">
            <span className="mb-1 block text-xs font-medium ios-muted">同步跳转地址 *</span>
            <div className="flex overflow-hidden rounded-lg border border-[color:var(--app-border)] bg-white/60">
              <span className="min-w-0 flex-1 truncate px-3 py-2 text-sm text-stone-500">
                {settingsForm.siteUrl || "https://your-site.example"}
              </span>
              <span className="shrink-0 border-l border-[color:var(--ios-separator)] px-3 py-2 text-sm font-semibold text-stone-600">
                {settings?.easyPayReturnPath || "/payment/result"}
              </span>
            </div>
          </label>
          <label className="admin-check-row">
            <input
              checked={settingsForm.clearEasyPayKey}
              className="size-4 accent-red-500"
              onChange={(event) =>
                handleUpdate({
                  clearEasyPayKey: event.target.checked,
                  easyPayKey: event.target.checked ? "" : settingsForm.easyPayKey
                })
              }
              type="checkbox"
            />
            清空 PKey
          </label>
        </div>
      </div>

      <section className="ios-panel overflow-hidden" data-testid="admin-coding-plan-settings">
        <div className="flex items-start justify-between gap-3 border-b border-[color:var(--ios-separator)] px-4 py-4">
          <div className="flex items-start gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-[color:var(--app-accent-soft)] text-[color:var(--claude-accent)]">
              <Code2 className="size-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Coding Plans</h2>
              <p className="mt-1 text-xs ios-muted">
                可配置多个固定售价的月度编码套餐；每次支付开通或顺延一个自然月，不自动续费。
              </p>
            </div>
          </div>
          <button
            className="ios-button-secondary app-action-button flex h-9 shrink-0 items-center justify-center gap-1.5 px-3 text-sm"
            disabled={settingsForm.codingPlans.length >= 12}
            onClick={() =>
              setSettingsForm((current) => ({
                ...current,
                codingPlans: [
                  ...current.codingPlans,
                  {
                    dailyCostLimitCents: 0,
                    description: "面向编码任务的月度额度套餐",
                    enabled: false,
                    id: `coding-plan-${Date.now().toString(36)}`,
                    monthlyCostLimitCents: 1000,
                    name: "新 Coding Plan",
                    personalApiEnabled: true,
                    priceCents: 1990,
                    weeklyCostLimitCents: 0
                  }
                ]
              }))
            }
            type="button"
          >
            <Plus className="size-4" />
            新增套餐
          </button>
        </div>
        <div className="grid gap-3 p-4">
          {settingsForm.codingPlans.map((plan, index) => (
            <div
              className="grid gap-3 rounded-xl border border-[color:var(--ios-separator)] bg-white/55 p-3 lg:grid-cols-6"
              key={plan.id}
            >
              <div className="flex items-center justify-between gap-3 lg:col-span-6">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-stone-950">{plan.name || "未命名套餐"}</p>
                  <p className="mt-0.5 text-xs ios-muted">套餐 ID：{plan.id}</p>
                </div>
                <button
                  className="ios-icon-button app-action-button shrink-0 text-red-600 hover:bg-red-50"
                  onClick={() =>
                    setSettingsForm((current) => ({
                      ...current,
                      codingPlans: current.codingPlans.filter((_, planIndex) => planIndex !== index)
                    }))
                  }
                  title="删除套餐"
                  type="button"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              <label className="admin-check-row lg:col-span-2">
                <input
                  checked={plan.enabled}
                  className="size-4 accent-[color:var(--claude-accent)]"
                  onChange={(event) =>
                    setSettingsForm((current) => ({
                      ...current,
                      codingPlans: current.codingPlans.map((item, planIndex) =>
                        planIndex === index ? { ...item, enabled: event.target.checked } : item
                      )
                    }))
                  }
                  type="checkbox"
                />
                对用户开放购买
              </label>
              <label className="admin-check-row lg:col-span-2">
                <input
                  checked={plan.personalApiEnabled}
                  className="size-4 accent-[color:var(--claude-accent)]"
                  onChange={(event) =>
                    setSettingsForm((current) => ({
                      ...current,
                      codingPlans: current.codingPlans.map((item, planIndex) =>
                        planIndex === index
                          ? { ...item, personalApiEnabled: event.target.checked }
                          : item
                      )
                    }))
                  }
                  type="checkbox"
                />
                套餐期内开放个人 API Key
              </label>
              <p className="self-center text-xs ios-muted lg:col-span-2">
                关闭 API 权益后，套餐仍提供月额度。
              </p>
              <label className="block lg:col-span-2">
                <span className="mb-1 block text-xs font-medium ios-muted">套餐名称</span>
                <input
                  className="ios-input w-full"
                  maxLength={80}
                  onChange={(event) =>
                    setSettingsForm((current) => ({
                      ...current,
                      codingPlans: current.codingPlans.map((item, planIndex) =>
                        planIndex === index ? { ...item, name: event.target.value } : item
                      )
                    }))
                  }
                  value={plan.name}
                />
              </label>
              <label className="block lg:col-span-2">
                <span className="mb-1 block text-xs font-medium ios-muted">售价（人民币）</span>
                <CentsDraftInput
                  className="ios-input w-full"
                  minCents={100}
                  onChange={(priceCents) =>
                    setSettingsForm((current) => ({
                      ...current,
                      codingPlans: current.codingPlans.map((item, planIndex) =>
                        planIndex === index ? { ...item, priceCents } : item
                      )
                    }))
                  }
                  value={plan.priceCents}
                />
              </label>
              <label className="block lg:col-span-2">
                <span className="mb-1 block text-xs font-medium ios-muted">每月额度（美元）</span>
                <CentsDraftInput
                  className="ios-input w-full"
                  minCents={1}
                  onChange={(monthlyCostLimitCents) =>
                    setSettingsForm((current) => ({
                      ...current,
                      codingPlans: current.codingPlans.map((item, planIndex) =>
                        planIndex === index ? { ...item, monthlyCostLimitCents } : item
                      )
                    }))
                  }
                  value={plan.monthlyCostLimitCents}
                />
              </label>
              <label className="block lg:col-span-2">
                <span className="mb-1 block text-xs font-medium ios-muted">每日限额（美元，0 为不限）</span>
                <CentsDraftInput
                  className="ios-input w-full"
                  minCents={0}
                  onChange={(dailyCostLimitCents) =>
                    setSettingsForm((current) => ({
                      ...current,
                      codingPlans: current.codingPlans.map((item, planIndex) =>
                        planIndex === index ? { ...item, dailyCostLimitCents } : item
                      )
                    }))
                  }
                  value={plan.dailyCostLimitCents}
                />
              </label>
              <label className="block lg:col-span-2">
                <span className="mb-1 block text-xs font-medium ios-muted">每周限额（美元，0 为不限）</span>
                <CentsDraftInput
                  className="ios-input w-full"
                  minCents={0}
                  onChange={(weeklyCostLimitCents) =>
                    setSettingsForm((current) => ({
                      ...current,
                      codingPlans: current.codingPlans.map((item, planIndex) =>
                        planIndex === index ? { ...item, weeklyCostLimitCents } : item
                      )
                    }))
                  }
                  value={plan.weeklyCostLimitCents}
                />
              </label>
              <label className="block lg:col-span-6">
                <span className="mb-1 block text-xs font-medium ios-muted">用户说明</span>
                <textarea
                  className="ios-input min-h-20 w-full resize-y"
                  maxLength={240}
                  onChange={(event) =>
                    setSettingsForm((current) => ({
                      ...current,
                      codingPlans: current.codingPlans.map((item, planIndex) =>
                        planIndex === index ? { ...item, description: event.target.value } : item
                      )
                    }))
                  }
                  value={plan.description}
                />
              </label>
              <div className="rounded-lg border border-[color:var(--ios-separator)] bg-white/60 px-3 py-2 text-sm text-stone-700 lg:col-span-6">
                {plan.enabled ? "上架" : "未上架"} · ¥{(plan.priceCents / 100).toFixed(2)} / 月 · 月额度 {formatCents(plan.monthlyCostLimitCents)}
                {plan.dailyCostLimitCents > 0 ? ` · 日限 ${formatCents(plan.dailyCostLimitCents)}` : ""}
                {plan.weeklyCostLimitCents > 0 ? ` · 周限 ${formatCents(plan.weeklyCostLimitCents)}` : ""}
                {plan.personalApiEnabled ? " · 含个人 API Key" : ""}
              </div>
            </div>
          ))}
          {settingsForm.codingPlans.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[color:var(--app-border)] bg-white/45 px-4 py-8 text-center text-sm ios-muted">
              暂无 Coding Plan。点击“新增套餐”后再保存即可上架。
            </div>
          ) : null}
        </div>
      </section>

      <section className="ios-panel overflow-hidden" data-testid="admin-payment-orders">
        <div className="flex flex-col gap-3 border-b border-[color:var(--ios-separator)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <div className="grid size-9 place-items-center rounded-lg bg-[color:var(--app-accent-soft)] text-[color:var(--claude-accent)]">
              <ReceiptText className="size-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold">支付订单</h2>
              <p className="mt-1 text-xs ios-muted">
                显示最近 {orders.length} 条 · 已到账 {summary.paidOrders} 笔
              </p>
            </div>
          </div>
          <button
            className="ios-button-secondary app-action-button flex h-9 items-center justify-center gap-2 px-3 text-sm disabled:opacity-50"
            disabled={loadingOrders}
            onClick={onRefreshOrders}
            type="button"
          >
            {loadingOrders ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            刷新订单
          </button>
        </div>

        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-[color:var(--ios-separator)] bg-white/60 px-3 py-2">
            <p className="text-xs ios-muted">订单数</p>
            <p className="mt-1 text-xl font-semibold">{summary.orders}</p>
            <p className="text-xs ios-muted">待支付 {summary.pendingOrders}</p>
          </div>
          <div className="rounded-lg border border-[color:var(--ios-separator)] bg-white/60 px-3 py-2">
            <p className="text-xs ios-muted">支付金额</p>
            <p className="mt-1 text-xl font-semibold">{formatPaymentYuan(summary.paidAmountCents)}</p>
            <p className="text-xs ios-muted">已到账订单付款</p>
          </div>
          <div className="rounded-lg border border-[color:var(--ios-separator)] bg-white/60 px-3 py-2">
            <p className="text-xs ios-muted">到账点数</p>
            <p className="mt-1 text-xl font-semibold">{formatCents(summary.paidBalanceCents)}</p>
            <p className="text-xs ios-muted">用户余额累计增量</p>
          </div>
          <div className="rounded-lg border border-[color:var(--ios-separator)] bg-white/60 px-3 py-2">
            <p className="flex items-center gap-1.5 text-xs ios-muted">
              <CreditCard className="size-3.5" />
              全部提交金额
            </p>
            <p className="mt-1 text-xl font-semibold">{formatPaymentYuan(summary.totalAmountCents)}</p>
            <p className="text-xs ios-muted">包含未支付订单</p>
          </div>
        </div>

        {loadingOrders ? (
          <div className="app-loading-pulse grid min-h-48 place-items-center text-slate-500">
            <Loader2 className="size-6 animate-spin" />
          </div>
        ) : orders.length > 0 ? (
          <>
            <div className="hidden overflow-x-auto lg:block" aria-label="充值订单表格横向滚动区域">
              <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
                <thead className="bg-white/70 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">订单</th>
                    <th className="px-4 py-3 font-semibold">用户</th>
                    <th className="px-4 py-3 font-semibold">支付</th>
                    <th className="px-4 py-3 font-semibold">权益</th>
                    <th className="px-4 py-3 font-semibold">状态</th>
                    <th className="px-4 py-3 font-semibold">时间</th>
                    <th className="px-4 py-3 text-right font-semibold">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => {
                    const status = paymentStatusMeta(order.status);

                    return (
                      <tr className="border-t border-[color:var(--ios-separator)]" key={order.id}>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-stone-900">{order.outTradeNo}</p>
                          <p className="mt-1 text-xs ios-muted">{order.subject}</p>
                          <p className="mt-1 text-xs ios-muted">{order.providerTradeNo || "未返回渠道流水号"}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-stone-900">{order.userName || "-"}</p>
                          <p className="mt-1 text-xs ios-muted">{order.userEmail || "-"}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold">{formatPaymentYuan(order.amountCents)}</p>
                          <p className="mt-1 text-xs ios-muted">{paymentMethodLabel(order.method)}</p>
                        </td>
                        <td className="px-4 py-3 font-semibold">{paymentBenefitLabel(order)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${status.tone}`}>
                            {status.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs ios-muted">
                          <p>创建 {formatDateTime(order.createdAt)}</p>
                          <p>到账 {order.paidAt ? formatDateTime(order.paidAt) : "-"}</p>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            {order.status === "PENDING" ? (
                              <button
                                className="ios-button-secondary app-action-button flex h-9 items-center justify-center gap-2 px-3 text-sm disabled:opacity-50"
                                disabled={loadingOrders || syncingOrderId === order.id}
                                onClick={() => onSyncOrder(order.id)}
                                type="button"
                              >
                                {syncingOrderId === order.id ? (
                                  <Loader2 className="size-4 animate-spin" />
                                ) : (
                                  <RefreshCw className="size-4" />
                                )}
                                补单
                              </button>
                            ) : (
                              null
                            )}
                            <button
                              className="ios-icon-button app-action-button text-red-600 hover:bg-red-50 disabled:opacity-50"
                              disabled={loadingOrders || deletingOrderId === order.id}
                              onClick={() => onSetDeleteOrderTarget(order)}
                              title="删除订单"
                              type="button"
                            >
                              {deletingOrderId === order.id ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <Trash2 className="size-4" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 p-4 lg:hidden">
              {orders.map((order) => {
                const status = paymentStatusMeta(order.status);

                return (
                  <div className="rounded-lg border border-[color:var(--ios-separator)] bg-white/60 p-3 text-sm" key={order.id}>
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-stone-900">{order.outTradeNo}</p>
                        <p className="mt-1 truncate text-xs ios-muted">{order.subject}</p>
                        <p className="mt-1 truncate text-xs ios-muted">{order.userName} · {order.userEmail}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${status.tone}`}>
                        {status.label}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg bg-white/65 px-3 py-2">
                        <p className="text-xs ios-muted">支付</p>
                        <p className="mt-1 font-semibold">{formatPaymentYuan(order.amountCents)}</p>
                      </div>
                      <div className="rounded-lg bg-white/65 px-3 py-2">
                        <p className="text-xs ios-muted">权益</p>
                        <p className="mt-1 font-semibold">{paymentBenefitLabel(order)}</p>
                      </div>
                    </div>
                    <p className="mt-2 text-xs ios-muted">
                      {paymentMethodLabel(order.method)} · 创建 {formatDateTime(order.createdAt)}
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {order.status === "PENDING" ? (
                        <button
                          className="ios-button-secondary app-action-button flex h-9 items-center justify-center gap-2 text-sm disabled:opacity-50"
                          disabled={loadingOrders || syncingOrderId === order.id}
                          onClick={() => onSyncOrder(order.id)}
                          type="button"
                        >
                          {syncingOrderId === order.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <RefreshCw className="size-4" />
                          )}
                          补单
                        </button>
                      ) : (
                        <span className="hidden" />
                      )}
                      <button
                        className={`ios-button-secondary app-action-button flex h-9 items-center justify-center gap-2 text-sm text-red-600 disabled:opacity-50 ${
                          order.status === "PENDING" ? "" : "col-span-2"
                        }`}
                        disabled={loadingOrders || deletingOrderId === order.id}
                        onClick={() => onSetDeleteOrderTarget(order)}
                        type="button"
                      >
                        {deletingOrderId === order.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                        删除
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="grid min-h-40 place-items-center px-4 py-8 text-center text-sm ios-muted">
            暂无充值订单。
          </div>
        )}
      </section>
    </div>
  );
}
