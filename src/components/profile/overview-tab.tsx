import { FormEvent } from "react";
import {
  BadgeDollarSign,
  CheckCircle2,
  Clock3,
  CreditCard,
  Loader2,
  Mail,
  ReceiptText,
  RefreshCw,
  Save,
  ShieldCheck,
  UserRound
} from "lucide-react";
import type {
  PaymentOrderSummaryView,
  PaymentOrderView,
  PublicPaymentSettingsView,
  UserView,
  UsageSummary
} from "@/types/gateway";
import { formatCents, formatNumber, formatShortDateTime } from "@/lib/format";
import { groupLabel } from "./components";

type OverviewTabProps = {
  user: UserView;
  name: string;
  setName: (name: string) => void;
  initialUsage: UsageSummary;
  loadingPayments: boolean;
  onRecharge: () => void;
  onRefreshPayments: () => void;
  savingProfile: boolean;
  onSaveProfile: (event: FormEvent<HTMLFormElement>) => void;
  paymentOrders: PaymentOrderView[];
  paymentSettings: PublicPaymentSettingsView;
  paymentSummary: PaymentOrderSummaryView;
};

function usagePercent(usage: UsageSummary) {
  const total = usage.monthlyCostLimitCents + usage.aiPointsCostUsedCents + usage.aiPointsBalanceCents;

  if (total <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round((usage.costUsedCents / total) * 100)));
}

function formatPaymentYuan(amountCents: number) {
  return `¥${(amountCents / 100).toFixed(2)}`;
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

export function OverviewTab({
  user,
  name,
  setName,
  initialUsage,
  loadingPayments,
  onRecharge,
  onRefreshPayments,
  savingProfile,
  onSaveProfile,
  paymentOrders,
  paymentSettings,
  paymentSummary
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
            {paymentSettings.easyPayEnabled ? (
              <button
                className="ios-button-primary app-action-button mt-4 flex h-10 w-full items-center justify-center gap-2 px-4 text-sm"
                data-testid="profile-recharge-button"
                onClick={onRecharge}
                type="button"
              >
                <CreditCard className="size-4" />
                充值 AI 点数
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="ios-panel motion-lift overflow-hidden" data-testid="profile-payment-orders">
        <div className="flex flex-col gap-3 border-b border-[color:var(--ios-separator)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <div className="grid size-9 place-items-center rounded-lg bg-[color:var(--app-accent-soft)] text-[color:var(--claude-accent)]">
              <ReceiptText className="size-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold">充值记录</h2>
              <p className="mt-1 text-xs ios-muted">
                已到账 {paymentSummary.paidOrders} 笔 · 累计到账 {formatCents(paymentSummary.paidBalanceCents)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {paymentSettings.easyPayEnabled ? (
              <button
                className="ios-button-primary app-action-button flex h-9 items-center justify-center gap-2 px-3 text-sm"
                data-testid="profile-recharge-button-secondary"
                onClick={onRecharge}
                type="button"
              >
                <CreditCard className="size-4" />
                充值
              </button>
            ) : null}
            <button
              className="ios-button-secondary app-action-button flex h-9 items-center justify-center gap-2 px-3 text-sm disabled:opacity-50"
              disabled={loadingPayments}
              onClick={onRefreshPayments}
              type="button"
            >
              {loadingPayments ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              刷新
            </button>
          </div>
        </div>

        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <div className="rounded-lg border border-[color:var(--ios-separator)] bg-white/60 px-3 py-2">
            <p className="text-xs ios-muted">订单数</p>
            <p className="mt-1 text-xl font-semibold">{formatNumber(paymentSummary.orders)}</p>
            <p className="text-xs ios-muted">待支付 {formatNumber(paymentSummary.pendingOrders)}</p>
          </div>
          <div className="rounded-lg border border-[color:var(--ios-separator)] bg-white/60 px-3 py-2">
            <p className="text-xs ios-muted">已支付</p>
            <p className="mt-1 text-xl font-semibold">{formatPaymentYuan(paymentSummary.paidAmountCents)}</p>
            <p className="text-xs ios-muted">人民币付款合计</p>
          </div>
          <div className="rounded-lg border border-[color:var(--ios-separator)] bg-white/60 px-3 py-2">
            <p className="text-xs ios-muted">已到账点数</p>
            <p className="mt-1 text-xl font-semibold">{formatCents(paymentSummary.paidBalanceCents)}</p>
            <p className="text-xs ios-muted">只统计已到账订单</p>
          </div>
        </div>

        {loadingPayments ? (
          <div className="app-loading-pulse grid min-h-36 place-items-center text-slate-500">
            <Loader2 className="size-6 animate-spin" />
          </div>
        ) : paymentOrders.length > 0 ? (
          <>
            <div className="hidden overflow-x-auto md:block" aria-label="充值记录表格横向滚动区域">
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <thead className="bg-white/70 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">订单</th>
                    <th className="px-4 py-3 font-semibold">支付</th>
                    <th className="px-4 py-3 font-semibold">到账</th>
                    <th className="px-4 py-3 font-semibold">状态</th>
                    <th className="px-4 py-3 font-semibold">时间</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentOrders.map((order) => {
                    const status = paymentStatusMeta(order.status);

                    return (
                      <tr className="border-t border-[color:var(--ios-separator)]" key={order.id}>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-stone-900">{order.outTradeNo}</p>
                          <p className="mt-1 text-xs ios-muted">{order.providerTradeNo || "未返回渠道流水号"}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold">{formatPaymentYuan(order.amountCents)}</p>
                          <p className="mt-1 text-xs ios-muted">{paymentMethodLabel(order.method)}</p>
                        </td>
                        <td className="px-4 py-3 font-semibold">{formatCents(order.balanceCents)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${status.tone}`}>
                            {status.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs ios-muted">
                          <p>创建 {formatShortDateTime(order.createdAt)}</p>
                          <p>到账 {order.paidAt ? formatShortDateTime(order.paidAt) : "-"}</p>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 p-4 md:hidden">
              {paymentOrders.map((order) => {
                const status = paymentStatusMeta(order.status);

                return (
                  <div className="rounded-lg border border-[color:var(--ios-separator)] bg-white/60 p-3 text-sm" key={order.id}>
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-stone-900">{order.outTradeNo}</p>
                        <p className="mt-1 text-xs ios-muted">{paymentMethodLabel(order.method)}</p>
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
                        <p className="text-xs ios-muted">到账</p>
                        <p className="mt-1 font-semibold">{formatCents(order.balanceCents)}</p>
                      </div>
                    </div>
                    <p className="mt-2 text-xs ios-muted">
                      创建 {formatShortDateTime(order.createdAt)} · 到账{" "}
                      {order.paidAt ? formatShortDateTime(order.paidAt) : "-"}
                    </p>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="grid min-h-36 place-items-center px-4 py-8 text-center text-sm ios-muted">
            暂无充值记录。
          </div>
        )}
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
