import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, readJson, requireActiveUser } from "@/lib/http";
import { hashPassword, verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type PasswordBody = {
  currentPassword?: string;
  newPassword?: string;
};

export async function PATCH(request: NextRequest) {
  const currentUser = await getUserFromRequest(request);
  const error = requireActiveUser(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  let body: PasswordBody;

  try {
    body = await readJson<PasswordBody>(request);
  } catch (readError) {
    return jsonError(readError instanceof Error ? readError.message : "修改密码失败。", 400);
  }

  const currentPassword = body.currentPassword || "";
  const newPassword = body.newPassword || "";

  if (newPassword.length < 8) {
    return jsonError("新密码至少 8 位。", 400);
  }

  const user = await prisma.user.findUnique({
    where: { id: currentUser.id },
    select: { passwordHash: true }
  });

  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
    return jsonError("当前密码不正确。", 400);
  }

  await prisma.user.update({
    where: { id: currentUser.id },
    data: { passwordHash: await hashPassword(newPassword) }
  });

  return NextResponse.json({ ok: true });
}
