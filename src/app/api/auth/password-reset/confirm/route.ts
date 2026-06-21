import { NextRequest, NextResponse } from "next/server";
import { recordAuthEvent } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/http";
import {
  findUsablePasswordResetToken
} from "@/lib/password-reset";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type PasswordResetConfirmBody = {
  password?: string;
  token?: string;
};

export async function POST(request: NextRequest) {
  let body: PasswordResetConfirmBody;

  try {
    body = await readJson<PasswordResetConfirmBody>(request);
  } catch (readError) {
    return jsonError(readError instanceof Error ? readError.message : "重置密码失败。", 400);
  }

  const token = body.token?.trim() || "";
  const password = body.password || "";

  if (!token) {
    return jsonError("重置链接缺少 token。", 400);
  }

  if (password.length < 8) {
    return jsonError("新密码至少 8 位。", 400);
  }

  const result = await findUsablePasswordResetToken(token);

  if (!result.ok) {
    return jsonError(result.message, 400);
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: result.record.userId },
      data: {
        passwordHash: await hashPassword(password)
      }
    }),
    prisma.userSession.updateMany({
      where: {
        userId: result.record.userId,
        revokedAt: null
      },
      data: {
        revokedAt: new Date(),
        revokedReason: "password_reset"
      }
    }),
    prisma.passwordResetToken.update({
      where: { id: result.record.id },
      data: { usedAt: new Date() }
    })
  ]);

  await recordAuthEvent({
    email: result.record.user.email,
    message: "密码已通过邮件链接重置。",
    request,
    success: true,
    type: "password_reset_completed",
    userId: result.record.userId
  });

  return NextResponse.json({ message: "密码已重置，请使用新密码登录。" });
}
