import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, requireAdmin } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function DELETE(request: NextRequest, context: RouteContext) {
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
    where: { id },
    select: { id: true }
  });

  if (!order) {
    return jsonError("充值订单不存在。", 404);
  }

  await prisma.paymentOrder.delete({
    where: { id }
  });

  return NextResponse.json({ ok: true });
}
