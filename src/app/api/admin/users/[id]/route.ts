import { NextRequest, NextResponse } from "next/server";
import { deleteAttachmentFiles } from "@/lib/attachments";
import { getUserFromRequest } from "@/lib/auth";
import { cacheDelete } from "@/lib/cache";
import { coerceInt, jsonError, readJson, requireAdmin } from "@/lib/http";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { usageCacheKey } from "@/lib/quota";
import { normalizeUserGroup } from "@/lib/user-groups";

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
  userGroup?: string;
  active?: boolean;
  emailVerified?: boolean;
  aiPointsBalanceCents?: number;
  monthlyCostLimitCents?: number;
  quotaNextResetAt?: string;
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
    userGroup?: string;
    active?: boolean;
    emailVerified?: boolean;
    aiPointsBalanceCents?: number;
    monthlyCostLimitCents?: number;
    quotaNextResetAt?: Date;
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

  if (body.userGroup !== undefined) {
    data.userGroup = normalizeUserGroup(body.userGroup);
  }

  if (typeof body.active === "boolean") {
    data.active = body.active;
  }

  if (typeof body.emailVerified === "boolean") {
    data.emailVerified = body.emailVerified;
  }

  if (body.aiPointsBalanceCents !== undefined) {
    data.aiPointsBalanceCents = coerceInt(body.aiPointsBalanceCents, 5000);
  }

  if (body.monthlyCostLimitCents !== undefined) {
    data.monthlyCostLimitCents = coerceInt(body.monthlyCostLimitCents, 0);
  }

  if (body.quotaNextResetAt !== undefined) {
    const quotaNextResetAt = new Date(body.quotaNextResetAt);

    if (Number.isNaN(quotaNextResetAt.getTime())) {
      return jsonError("下次刷新时间无效。", 400);
    }

    if (quotaNextResetAt <= new Date()) {
      return jsonError("下次刷新时间必须晚于当前时间。", 400);
    }

    data.quotaNextResetAt = quotaNextResetAt;
  }

  if (Object.keys(data).length === 0) {
    return jsonError("没有可更新字段。", 400);
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    select: { id: true }
  });
  await cacheDelete([usageCacheKey(user.id)]);

  return NextResponse.json({ id: user.id });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const currentUser = await getUserFromRequest(request);
  const error = requireAdmin(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  const { id } = await context.params;

  if (id === currentUser.id) {
    return jsonError("不能删除当前登录的管理员账号。", 400);
  }

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      attachments: {
        select: { storagePath: true }
      }
    }
  });

  if (!user) {
    return jsonError("用户不存在。", 404);
  }

  await prisma.user.delete({
    where: { id }
  });
  await cacheDelete([usageCacheKey(id)]);
  await deleteAttachmentFiles(user.attachments);

  return NextResponse.json({ id });
}
