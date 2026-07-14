import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest, recordAuthEvent } from "@/lib/auth";
import { coerceInt, jsonError, readJson, requireAdmin } from "@/lib/http";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { getUsageSummary, nextQuotaResetAt } from "@/lib/quota";
import { normalizeUserGroup } from "@/lib/user-groups";

export const runtime = "nodejs";

type CreateUserBody = {
  email?: string;
  name?: string;
  password?: string;
  role?: "USER" | "ADMIN";
  userGroup?: string;
  aiPointsBalanceCents?: number;
  monthlyCostLimitCents?: number;
};

export async function GET(request: NextRequest) {
  const currentUser = await getUserFromRequest(request);
  const error = requireAdmin(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  const users = await prisma.user.findMany({
    orderBy: [{ role: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      userGroup: true,
      active: true,
      emailVerified: true,
      aiStylePrompt: true,
      aiPointsBalanceCents: true,
      codingPlanDailyCostLimitCents: true,
      codingPlanExpiresAt: true,
      codingPlanId: true,
      codingPlanMonthlyCostLimitCents: true,
      codingPlanName: true,
      codingPlanPersonalApiEnabled: true,
      codingPlanWeeklyCostLimitCents: true,
      monthlyCostLimitCents: true,
      quotaNextResetAt: true,
      quotaResetAt: true,
      createdAt: true,
      updatedAt: true
    }
  });

  const usersWithUsage = await Promise.all(
    users.map(async (user) => {
      const [usage, activeSessionCount, lastSession, lastLogin] = await Promise.all([
        getUsageSummary(user.id, { readCache: false }),
        prisma.userSession.count({
          where: {
            userId: user.id,
            revokedAt: null,
            expiresAt: { gt: new Date() }
          }
        }),
        prisma.userSession.findFirst({
          where: { userId: user.id },
          orderBy: { lastSeenAt: "desc" },
          select: { lastSeenAt: true }
        }),
        prisma.authEvent.findFirst({
          where: {
            userId: user.id,
            type: "login",
            success: true
          },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true }
        })
      ]);

      return {
        ...user,
        activeSessionCount,
        aiPointsBalanceCents: usage.aiPointsBalanceCents,
        codingPlanExpiresAt: user.codingPlanExpiresAt?.toISOString() ?? null,
        monthlyCostLimitCents: usage.monthlyCostLimitCents,
        quotaNextResetAt: usage.windowEnd,
        quotaResetAt: usage.windowStart,
        createdAt: user.createdAt.toISOString(),
        lastLoginAt: lastLogin?.createdAt.toISOString() ?? null,
        lastSeenAt: lastSession?.lastSeenAt.toISOString() ?? null,
        updatedAt: user.updatedAt.toISOString(),
        usage
      };
    })
  );

  return NextResponse.json({ users: usersWithUsage });
}

export async function POST(request: NextRequest) {
  const currentUser = await getUserFromRequest(request);
  const error = requireAdmin(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  let body: CreateUserBody;

  try {
    body = await readJson<CreateUserBody>(request);
  } catch (readError) {
    return jsonError(readError instanceof Error ? readError.message : "创建用户失败。", 400);
  }

  const email = body.email?.trim().toLowerCase();
  const name = body.name?.trim() || email;
  const password = body.password ?? "";

  if (!email || !password || password.length < 8) {
    return jsonError("请输入邮箱和至少 8 位密码。", 400);
  }

  try {
    const quotaResetAt = new Date();
    const user = await prisma.user.create({
      data: {
        email,
        name: name || email,
        passwordHash: await hashPassword(password),
        role: body.role === "ADMIN" ? "ADMIN" : "USER",
        userGroup: normalizeUserGroup(body.userGroup),
        emailVerified: true,
        aiPointsBalanceCents: coerceInt(body.aiPointsBalanceCents, 5000),
        monthlyCostLimitCents: coerceInt(body.monthlyCostLimitCents, 0),
        quotaResetAt,
        quotaNextResetAt: nextQuotaResetAt(quotaResetAt),
        quotaSystemMigratedAt: quotaResetAt
      },
      select: {
        id: true
      }
    });
    await recordAuthEvent({
      email,
      message: "管理员创建用户。",
      request,
      success: true,
      type: "admin_user_created",
      userId: user.id
    });

    return NextResponse.json({ id: user.id }, { status: 201 });
  } catch (createError) {
    const message =
      createError instanceof Error && createError.message.includes("Unique constraint")
        ? "邮箱已存在。"
        : "创建用户失败。";

    return jsonError(message, 400);
  }
}
