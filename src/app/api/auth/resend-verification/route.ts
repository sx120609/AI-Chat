import { NextRequest, NextResponse } from "next/server";
import { createEmailVerificationToken, sendVerificationEmail } from "@/lib/email-verification";
import { jsonError, readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { normalizeSiteName, normalizeSiteUrl } from "@/lib/site-settings";
import { normalizeEmail, normalizeSmtpSettings } from "@/lib/smtp";

export const runtime = "nodejs";

type ResendBody = {
  email?: string;
};

function getRequestBaseUrl(request: NextRequest, siteUrl: string) {
  return siteUrl || request.nextUrl.origin;
}

export async function POST(request: NextRequest) {
  let body: ResendBody;

  try {
    body = await readJson<ResendBody>(request);
  } catch (readError) {
    return jsonError(readError instanceof Error ? readError.message : "发送验证邮件失败。", 400);
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

  if (!user || user.emailVerified) {
    return NextResponse.json({ message: "如果该邮箱需要验证，系统会发送新的验证邮件。" });
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

  const token = await createEmailVerificationToken(user.id);
  const siteUrl = normalizeSiteUrl(settings?.siteUrl || process.env.SITE_URL);
  const verificationUrl = `${getRequestBaseUrl(request, siteUrl)}/verify-email?token=${encodeURIComponent(token)}`;

  await sendVerificationEmail({
    settings: smtpSettings,
    siteName: normalizeSiteName(settings?.siteName || process.env.SITE_NAME),
    to: email,
    verificationUrl
  });

  return NextResponse.json({ message: "验证邮件已发送，请查收。" });
}
