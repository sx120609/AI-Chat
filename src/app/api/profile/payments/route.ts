import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { coerceInt, jsonError, requireActiveUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LIMIT = 100;

function serializeOrder(order: {
  id: string;
  provider: string;
  method: string;
  status: string;
  outTradeNo: string;
  providerTradeNo: string | null;
  subject: string;
  amountCents: number;
  balanceCents: number;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: order.id,
    provider: order.provider,
    method: order.method,
    status: order.status,
    outTradeNo: order.outTradeNo,
    providerTradeNo: order.providerTradeNo,
    subject: order.subject,
    amountCents: order.amountCents,
    balanceCents: order.balanceCents,
    paidAt: order.paidAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString()
  };
}

export async function GET(request: NextRequest) {
  const user = await getUserFromRequest(request);
  const authError = requireActiveUser(user);

  if (!user) {
    return jsonError("请先登录。", 401);
  }

  if (authError) {
    return authError;
  }

  const limit = Math.min(
    MAX_LIMIT,
    coerceInt(request.nextUrl.searchParams.get("limit"), 20, 1)
  );
  const orders = await prisma.paymentOrder.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: limit
  });
  const [total, paidOrders, pendingOrders, paidAggregate, allAggregate] =
    await prisma.$transaction([
      prisma.paymentOrder.count({ where: { userId: user.id } }),
      prisma.paymentOrder.count({ where: { userId: user.id, status: "PAID" } }),
      prisma.paymentOrder.count({ where: { userId: user.id, status: "PENDING" } }),
      prisma.paymentOrder.aggregate({
        where: { userId: user.id, status: "PAID" },
        _sum: { amountCents: true, balanceCents: true }
      }),
      prisma.paymentOrder.aggregate({
        where: { userId: user.id },
        _sum: { amountCents: true }
      })
    ]);

  return NextResponse.json({
    orders: orders.map(serializeOrder),
    summary: {
      orders: total,
      paidOrders,
      pendingOrders,
      totalAmountCents: allAggregate._sum.amountCents ?? 0,
      paidAmountCents: paidAggregate._sum.amountCents ?? 0,
      paidBalanceCents: paidAggregate._sum.balanceCents ?? 0
    }
  });
}
