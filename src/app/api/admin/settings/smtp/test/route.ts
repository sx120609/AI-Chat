import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, readJson, requireAdmin } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { normalizeSiteName } from "@/lib/site-settings";
import { normalizeEmail, normalizeSmtpSettings, sendSmtpMail } from "@/lib/smtp";

export const runtime = "nodejs";

type TestMailBody = {
  to?: string;
};

export async function POST(request: NextRequest) {
  const currentUser = await getUserFromRequest(request);
  const error = requireAdmin(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  let body: TestMailBody = {};

  try {
    body = await readJson<TestMailBody>(request);
  } catch {
    body = {};
  }

  const settings = await prisma.aiSettings.findUnique({
    where: { id: "default" }
  });

  if (!settings) {
    return jsonError("系统设置不存在。", 400);
  }

  let smtpSettings;
  let to: string;

  try {
    smtpSettings = normalizeSmtpSettings(settings);
    to = normalizeEmail(body.to) || currentUser.email;
  } catch (smtpError) {
    return jsonError(smtpError instanceof Error ? smtpError.message : "邮件服务设置无效。", 400);
  }

  await sendSmtpMail(smtpSettings, {
    to,
    subject: `${normalizeSiteName(settings.siteName)} SMTP 测试邮件`,
    text: "这是一封 SMTP 测试邮件。如果你收到它，说明邮件服务配置可用。",
    html: "<p>这是一封 SMTP 测试邮件。如果你收到它，说明邮件服务配置可用。</p>"
  });

  return NextResponse.json({ message: `测试邮件已发送到 ${to}。` });
}
