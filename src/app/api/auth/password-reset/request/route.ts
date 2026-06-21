import { NextRequest, NextResponse } from "next/server";
import { recordAuthEvent } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/http";
import {
  createPasswordResetToken,
  sendPasswordResetEmail
} from "@/lib/password-reset";
import { prisma } from "@/lib/prisma";
import { normalizeSiteName, normalizeSiteUrl } from "@/lib/site-settings";
import { describeSmtpError, normalizeEmail, normalizeSmtpSettings } from "@/lib/smtp";

export const runtime = "nodejs";

type PasswordResetRequestBody = {
  email?: string;
};

const GENERIC_MESSAGE = "如果这个邮箱存在可用账号，系统会发送一封重置密码邮件。";

function getRequestBaseUrl(request: NextRequest, siteUrl: string) {
  return siteUrl || request.nextUrl.origin;
}

export async function POST(request: NextRequest) {
  let body: PasswordResetRequestBody;

  try {
    body = await readJson<PasswordResetRequestBody>(request);
  } catch (readError) {
    return jsonError(readError instanceof Error ? readError.message : "发送重置邮件失败。", 400);
  }

  let email: string;

  try {
    email = normalizeEmail(body.email);
  } catch (emailError) {
    return jsonError(emailError instanceof Error ? emailError.message : "邮箱格式无效。", 400);
  }

  const user = await prisma.user.findUnique({
    where: { email }
  });

  if (!user || !user.active) {
    await recordAuthEvent({
      email,
      message: user ? "账号已停用。" : "邮箱不存在。",
      request,
      success: false,
      type: "password_reset_requested"
    });

    return NextResponse.json({ message: GENERIC_MESSAGE });
  }

  const settings = await prisma.aiSettings.findUnique({
    where: { id: "default" }
  });

  let smtpSettings;

  try {
    smtpSettings = normalizeSmtpSettings({
      smtpEnabled: settings?.smtpEnabled ?? process.env.SMTP_ENABLED === "true",
      smtpHost: settings?.smtpHost ?? process.env.SMTP_HOST,
      smtpPort: settings?.smtpPort ?? (Number(process.env.SMTP_PORT) || 587),
      smtpUsername: settings?.smtpUsername ?? process.env.SMTP_USERNAME,
      smtpPassword: settings?.smtpPassword ?? process.env.SMTP_PASSWORD,
      smtpFromEmail: settings?.smtpFromEmail ?? process.env.SMTP_FROM_EMAIL,
      smtpFromName: settings?.smtpFromName ?? process.env.SMTP_FROM_NAME,
      smtpSecure: settings?.smtpSecure ?? process.env.SMTP_SECURE === "true",
      smtpStartTls: settings?.smtpStartTls ?? process.env.SMTP_STARTTLS !== "false"
    });
  } catch {
    return jsonError("邮件服务未正确配置。", 400);
  }

  const siteUrl = normalizeSiteUrl(settings?.siteUrl || process.env.SITE_URL);
  const token = await createPasswordResetToken(user.id);
  const resetUrl = `${getRequestBaseUrl(request, siteUrl)}/reset-password?token=${encodeURIComponent(token)}`;

  try {
    await sendPasswordResetEmail({
      resetUrl,
      settings: smtpSettings,
      siteName: normalizeSiteName(settings?.siteName || process.env.SITE_NAME),
      to: email
    });
  } catch (sendError) {
    return jsonError(describeSmtpError(sendError), 502);
  }

  await recordAuthEvent({
    email,
    message: "已发送密码重置邮件。",
    request,
    success: true,
    type: "password_reset_requested",
    userId: user.id
  });

  return NextResponse.json({ message: GENERIC_MESSAGE });
}
