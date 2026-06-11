import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { coerceInt, jsonError, readJson, requireAdmin } from "@/lib/http";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type UpdateUserBody = {
  name?: string;
  password?: string;
  role?: "USER" | "ADMIN";
  active?: boolean;
  monthlyTokenLimit?: number;
  monthlyMessageLimit?: number;
  monthlyCostLimitCents?: number;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const currentUser = await getUserFromRequest(request);
  const error = requireAdmin(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  const { id } = await context.params;
  let body: UpdateUserBody;

  try {
    body = await readJson<UpdateUserBody>(request);
  } catch (readError) {
    return jsonError(readError instanceof Error ? readError.message : "更新用户失败。", 400);
  }

  const data: {
    name?: string;
    passwordHash?: string;
    role?: "USER" | "ADMIN";
    active?: boolean;
    monthlyTokenLimit?: number;
    monthlyMessageLimit?: number;
    monthlyCostLimitCents?: number;
  } = {};

  if (typeof body.name === "string" && body.name.trim()) {
    data.name = body.name.trim();
  }

  if (typeof body.password === "string" && body.password.length > 0) {
    if (body.password.length < 8) {
      return jsonError("新密码至少 8 位。", 400);
    }

    data.passwordHash = await hashPassword(body.password);
  }

  if (body.role === "ADMIN" || body.role === "USER") {
    data.role = body.role;
  }

  if (typeof body.active === "boolean") {
    data.active = body.active;
  }

  if (body.monthlyTokenLimit !== undefined) {
    data.monthlyTokenLimit = coerceInt(body.monthlyTokenLimit, 200000, 1);
  }

  if (body.monthlyMessageLimit !== undefined) {
    data.monthlyMessageLimit = coerceInt(body.monthlyMessageLimit, 500, 1);
  }

  if (body.monthlyCostLimitCents !== undefined) {
    data.monthlyCostLimitCents = coerceInt(body.monthlyCostLimitCents, 5000, 1);
  }

  if (Object.keys(data).length === 0) {
    return jsonError("没有可更新字段。", 400);
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    select: { id: true }
  });

  return NextResponse.json({ id: user.id });
}
