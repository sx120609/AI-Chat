import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import {
  normalizeEasyPaySettings,
  queryEasyPayOrder
} from "@/lib/easypay";
import { jsonError, requireAdmin } from "@/lib/http";
import { settlePaidPaymentOrder } from "@/lib/payment-orders";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const user = await getUserFromRequest(request);
  const authError = requireAdmin(user);

  if (!user) {
    return jsonError("请先登录。", 401);
  }

  if (authError) {
    return authError;
  }

  const { id } = await context.params;
  const order = await prisma.paymentOrder.findUnique({
    where: { id }
  });

  if (!order) {
    return jsonError("充值订单不存在。", 404);
  }

  if (order.status === "PAID") {
    return NextResponse.json({
      message: "订单已到账。",
      settled: false
    });
  }

  const settings = await prisma.aiSettings.findUnique({
    where: { id: "default" }
  });
  const easyPaySettings = normalizeEasyPaySettings(settings ?? {});

  if (!easyPaySettings.easyPayEnabled || !easyPaySettings.easyPayKey) {
    return jsonError("易支付未启用或 PKey 未配置。", 400);
  }

  const upstreamOrder = await queryEasyPayOrder(easyPaySettings, order.outTradeNo);

  if (!upstreamOrder.paid) {
    return jsonError("支付平台仍显示该订单未支付。", 409, {
      upstreamStatus: upstreamOrder.status || "unknown"
    });
  }

  if (upstreamOrder.amountCents !== order.amountCents) {
    return jsonError("支付平台订单金额与本地订单不一致，已停止补单。", 409, {
      expectedAmountCents: order.amountCents,
      upstreamAmountCents: upstreamOrder.amountCents
    });
  }

  const settled = await settlePaidPaymentOrder(order, {
    paidAt: upstreamOrder.paidAt,
    providerTradeNo: upstreamOrder.providerTradeNo
  });

  return NextResponse.json({
    balanceCents: settled.balanceCents,
    message: settled.settled ? "补单成功，AI 点数已到账。" : "订单已到账。",
    providerTradeNo: upstreamOrder.providerTradeNo,
    settled: settled.settled
  });
}
