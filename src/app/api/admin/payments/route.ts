import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "../../../../../generated/prisma/client";
import { getUserFromRequest } from "@/lib/auth";
import { coerceInt, jsonError, requireAdmin } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LIMIT = 100;

function buildPaymentWhere(searchParams: URLSearchParams): Prisma.PaymentOrderWhereInput {
  const and: Prisma.PaymentOrderWhereInput[] = [];
  const query = (searchParams.get("q") || "").trim();
  const status = (searchParams.get("status") || "").trim();
  const userId = (searchParams.get("userId") || "").trim();

  if (status && status !== "all") {
    and.push({ status });
  }

  if (userId && userId !== "all") {
    and.push({ userId });
  }

  if (query) {
    and.push({
      OR: [
        { outTradeNo: { contains: query, mode: "insensitive" } },
        { providerTradeNo: { contains: query, mode: "insensitive" } },
        { subject: { contains: query, mode: "insensitive" } },
        { user: { email: { contains: query, mode: "insensitive" } } },
        { user: { name: { contains: query, mode: "insensitive" } } }
      ]
    });
  }

  return and.length > 0 ? { AND: and } : {};
}

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
  userId: string;
  user: {
    email: string;
    name: string;
  };
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
    updatedAt: order.updatedAt.toISOString(),
    userId: order.userId,
    userEmail: order.user.email,
    userName: order.user.name
  };
}

export async function GET(request: NextRequest) {
  const user = await getUserFromRequest(request);
  const authError = requireAdmin(user);

  if (!user) {
    return jsonError("请先登录。", 401);
  }

  if (authError) {
    return authError;
  }

  const limit = Math.min(
    MAX_LIMIT,
    coerceInt(request.nextUrl.searchParams.get("limit"), 50, 1)
  );
  const where = buildPaymentWhere(request.nextUrl.searchParams);
  const [orders, total, paidOrders, pendingOrders, paidAggregate, allAggregate, users] =
    await prisma.$transaction([
      prisma.paymentOrder.findMany({
        where,
        include: {
          user: {
            select: {
              email: true,
              name: true
            }
          }
        },
        orderBy: { createdAt: "desc" },
        take: limit
      }),
      prisma.paymentOrder.count({ where }),
      prisma.paymentOrder.count({ where: { ...where, status: "PAID" } }),
      prisma.paymentOrder.count({ where: { ...where, status: "PENDING" } }),
      prisma.paymentOrder.aggregate({
        where: { ...where, status: "PAID" },
        _sum: { amountCents: true, balanceCents: true }
      }),
      prisma.paymentOrder.aggregate({
        where,
        _sum: { amountCents: true }
      }),
      prisma.user.findMany({
        orderBy: { email: "asc" },
        select: {
          email: true,
          id: true,
          name: true
        }
      })
    ]);

  return NextResponse.json({
    filterOptions: {
      users: users.map((item) => ({
        id: item.id,
        label: `${item.name} · ${item.email}`
      }))
    },
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
