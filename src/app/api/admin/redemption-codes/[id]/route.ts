import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, readJson, requireAdmin } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { serializeRedemptionCode } from "@/lib/redemption-codes";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type UpdateRedemptionCodeBody = {
  active?: boolean;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const currentUser = await getUserFromRequest(request);
  const authError = requireAdmin(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (authError) {
    return authError;
  }

  let body: UpdateRedemptionCodeBody;

  try {
    body = await readJson<UpdateRedemptionCodeBody>(request);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "更新兑换码失败。", 400);
  }

  if (typeof body.active !== "boolean") {
    return jsonError("缺少有效的兑换码状态。", 400);
  }

  const { id } = await context.params;
  const existing = await prisma.redemptionCode.findUnique({ where: { id } });

  if (!existing) {
    return jsonError("兑换码不存在。", 404);
  }

  const code = await prisma.redemptionCode.update({
    where: { id },
    data: { active: body.active }
  });

  return NextResponse.json({ code: serializeRedemptionCode(code) });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const currentUser = await getUserFromRequest(request);
  const authError = requireAdmin(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (authError) {
    return authError;
  }

  const { id } = await context.params;
  const code = await prisma.redemptionCode.findUnique({ where: { id } });

  if (!code) {
    return jsonError("兑换码不存在。", 404);
  }

  if (code.redeemedCount > 0) {
    return jsonError("已有兑换记录的兑换码不能删除；可以将其停用以保留审计记录。", 409);
  }

  await prisma.redemptionCode.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
