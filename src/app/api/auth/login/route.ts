import { NextRequest, NextResponse } from "next/server";
import {
  createSessionToken,
  recordAuthEvent,
  sessionCookieOptions,
  SESSION_COOKIE
} from "@/lib/auth";
import { jsonError, readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";

export const runtime = "nodejs";

type LoginBody = {
  email?: string;
  password?: string;
};

export async function POST(request: NextRequest) {
  let body: LoginBody;

  try {
    body = await readJson<LoginBody>(request);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "登录失败。", 400);
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";

  if (!email || !password) {
    return jsonError("请输入邮箱和密码。", 400);
  }

  const user = await prisma.user.findUnique({
    where: { email }
  });

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    await recordAuthEvent({
      email,
      message: "邮箱或密码不正确。",
      request,
      success: false,
      type: "login"
    });
    return jsonError("邮箱或密码不正确。", 401);
  }

  if (!user.active) {
    await recordAuthEvent({
      email,
      message: "账号已停用。",
      request,
      success: false,
      type: "login",
      userId: user.id
    });
    return jsonError("账号已停用。", 403);
  }

  if (user.role !== "ADMIN" && !user.emailVerified) {
    await recordAuthEvent({
      email,
      message: "邮箱未验证。",
      request,
      success: false,
      type: "login",
      userId: user.id
    });
    return jsonError("请先完成邮箱验证。", 403, { code: "EMAIL_UNVERIFIED" });
  }

  const response = NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    }
  });

  response.cookies.set(SESSION_COOKIE, await createSessionToken(user, request), sessionCookieOptions());
  await recordAuthEvent({
    email,
    message: "登录成功。",
    request,
    success: true,
    type: "login",
    userId: user.id
  });

  return response;
}
