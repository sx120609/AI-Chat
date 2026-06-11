import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { coerceInt, jsonError, readJson, requireAdmin } from "@/lib/http";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { getUsageSummary } from "@/lib/quota";

export const runtime = "nodejs";

type CreateUserBody = {
  email?: string;
  name?: string;
  password?: string;
  role?: "USER" | "ADMIN";
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
      active: true,
      monthlyCostLimitCents: true,
      quotaResetAt: true,
      createdAt: true,
      updatedAt: true
    }
  });

  const usersWithUsage = await Promise.all(
    users.map(async (user) => ({
      ...user,
      quotaResetAt: user.quotaResetAt.toISOString(),
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      usage: await getUsageSummary(user.id)
    }))
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
    const user = await prisma.user.create({
      data: {
        email,
        name: name || email,
        passwordHash: await hashPassword(password),
        role: body.role === "ADMIN" ? "ADMIN" : "USER",
        monthlyCostLimitCents: coerceInt(body.monthlyCostLimitCents, 5000, 1)
      },
      select: {
        id: true
      }
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
