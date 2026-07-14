import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckCircle2, Clock3, XCircle } from "lucide-react";
import { DocumentTitle } from "@/components/document-title";
import { SiteLogo } from "@/components/site-logo";
import { getCurrentUser } from "@/lib/auth";
import { formatCents } from "@/lib/format";
import { parseCodingPlanOrderSnapshot } from "@/lib/coding-plan";
import { prisma } from "@/lib/prisma";
import { getSiteSettings } from "@/lib/site-settings";

type PaymentResultPageProps = {
  searchParams: Promise<{
    out_trade_no?: string;
    trade_status?: string;
  }>;
};

export async function generateMetadata(): Promise<Metadata> {
  const siteSettings = await getSiteSettings();

  return {
    title: siteSettings.siteName
  };
}

export default async function PaymentResultPage({ searchParams }: PaymentResultPageProps) {
  const user = await getCurrentUser();

  if (!user || !user.active || !user.emailVerified) {
    redirect("/login");
  }

  const siteSettings = await getSiteSettings();
  const { out_trade_no: outTradeNo } = await searchParams;
  const order = outTradeNo
    ? await prisma.paymentOrder.findFirst({
        where: {
          outTradeNo,
          userId: user.id
        }
      })
    : null;
  const paid = order?.status === "PAID";
  const missing = !order;
  const codingPlan = order ? parseCodingPlanOrderSnapshot(order.metadataJson) : null;
  const creditedBalanceCents = order
    ? order.balanceCents > 0
      ? order.balanceCents
      : order.amountCents
    : 0;
  const Icon = paid ? CheckCircle2 : missing ? XCircle : Clock3;

  return (
    <main className="ios-page app-shell app-route-enter grid place-items-center px-5 py-10">
      <DocumentTitle title={siteSettings.siteName} />
      <div className="ios-panel app-card-enter motion-lift w-full max-w-sm p-6">
        <div className="mb-5 flex items-center gap-2">
          <SiteLogo className="size-8 shrink-0" />
          <p className="min-w-0 truncate text-sm font-semibold text-[color:var(--claude-accent)]">
            {siteSettings.siteName}
          </p>
        </div>
        <div className="mb-5 flex items-start gap-3">
          <div
            className={`grid size-10 shrink-0 place-items-center rounded-lg ${
              paid
                ? "bg-green-50 text-green-700"
                : missing
                  ? "bg-red-50 text-red-700"
                  : "bg-amber-50 text-amber-700"
            }`}
          >
            <Icon className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-stone-950">
              {paid
                ? codingPlan
                  ? "套餐已生效"
                  : "充值已到账"
                : missing
                  ? "未找到订单"
                  : "正在确认支付"}
            </h1>
            <p className="mt-1 text-sm leading-6 ios-muted">
              {paid
                ? codingPlan
                  ? `${codingPlan.name} 已开通一个月，每月可用 ${formatCents(codingPlan.monthlyCostLimitCents)} 额度。`
                  : `已为你的账号增加 ${formatCents(creditedBalanceCents)} AI 点数。`
                : missing
                  ? "请确认订单来自当前登录账号，或返回聊天页重新发起支付。"
                  : "如果已经完成付款，系统会在异步通知到达后自动入账。"}
            </p>
          </div>
        </div>
        <a
          className="ios-button-primary app-action-button flex h-11 w-full items-center justify-center px-4"
          href="/chat"
        >
          返回聊天
        </a>
      </div>
    </main>
  );
}
