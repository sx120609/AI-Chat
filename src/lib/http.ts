import { NextResponse } from "next/server";
import type { CurrentUser } from "@/lib/auth";

export function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json(
    {
      error: message,
      ...extra
    },
    { status }
  );
}

export function requireActiveUser(user: CurrentUser | null) {
  if (!user) {
    return jsonError("请先登录。", 401);
  }

  if (!user.active) {
    return jsonError("账号已停用。", 403);
  }

  return null;
}

export function requireAdmin(user: CurrentUser | null) {
  const userError = requireActiveUser(user);

  if (userError) {
    return userError;
  }

  if (user?.role !== "ADMIN") {
    return jsonError("需要管理员权限。", 403);
  }

  return null;
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new Error("请求体不是有效 JSON。");
  }
}

export function coerceInt(value: unknown, fallback: number, min = 0) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, parsed);
}
