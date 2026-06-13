import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth";
import { createEmailVerificationToken, sendVerificationEmail } from "@/lib/email-verification";
import { jsonError, readJson } from "@/lib/http";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { normalizeSiteName, normalizeSiteUrl } from "@/lib/site-settings";
import { describeSmtpError, normalizeEmail, normalizeSmtpSettings } from "@/lib/smtp";
import { DEFAULT_REGISTRATION_COST_LIMIT_CENTS } from "@/lib/auth-settings";

export const runtime = "nodejs";
const VERIFICATION_EMAIL_HINT = "如果收件箱里没看到，可以检查垃圾邮件或广告邮件。";

type RegisterBody = {
  email?: string;
  name?: string;
  password?: string;
};

function isUniqueConstraint(error: unknown) {
  return error instanceof Error && error.message.includes("Unique constraint");
}

function getRequestBaseUrl(request: NextRequest, siteUrl: string) {
  if (siteUrl) {
    return siteUrl;
  }

  return request.nextUrl.origin;
}

export async function POST(request: NextRequest) {
  const settings = await prisma.aiSettings.findUnique({
    where: { id: "default" }
  });
  const registrationEnabled =
    settings?.registrationEnabled ?? process.env.REGISTRATION_ENABLED === "true";
  const requireEmailVerification =
    settings?.registrationRequireEmailVerification ??
    process.env.REGISTRATION_REQUIRE_EMAIL_VERIFICATION === "true";

  if (!registrationEnabled) {
    return jsonError("注册暂未开放。", 403);
  }

  let body: RegisterBody;

  try {
    body = await readJson<RegisterBody>(request);
  } catch (readError) {
    return jsonError(readError instanceof Error ? readError.message : "注册失败。", 400);
  }

  let email: string;

  try {
    email = normalizeEmail(body.email);
  } catch (emailError) {
    return jsonError(emailError instanceof Error ? emailError.message : "邮箱格式无效。", 400);
  }

  const password = body.password ?? "";
  const name = body.name?.trim().slice(0, 80) || email.split("@")[0] || email;

  if (!email || password.length < 8) {
    return jsonError("请输入邮箱和至少 8 位密码。", 400);
  }

  let createdUserId = "";

  try {
    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash: await hashPassword(password),
        role: "USER",
        active: true,
        emailVerified: !requireEmailVerification,
        monthlyCostLimitCents:
          settings?.registrationDefaultCostLimitCents ||
          Number(process.env.REGISTRATION_DEFAULT_COST_LIMIT_CENTS) ||
          DEFAULT_REGISTRATION_COST_LIMIT_CENTS
      }
    });
    createdUserId = user.id;

    if (requireEmailVerification) {
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
        throw new Error("注册邮件服务未正确配置。");
      }

      const token = await createEmailVerificationToken(user.id);
      const siteName = normalizeSiteName(settings?.siteName || process.env.SITE_NAME);
      const siteUrl = normalizeSiteUrl(settings?.siteUrl || process.env.SITE_URL);
      const verificationUrl = `${getRequestBaseUrl(request, siteUrl)}/verify-email?token=${encodeURIComponent(token)}`;

      try {
        await sendVerificationEmail({
          settings: smtpSettings,
          siteName,
          to: email,
          verificationUrl
        });
      } catch (sendError) {
        throw new Error(describeSmtpError(sendError));
      }

      return NextResponse.json(
        {
          needsVerification: true,
          message: `注册成功，请查收验证邮件后登录。${VERIFICATION_EMAIL_HINT}`
        },
        { status: 201 }
      );
    }

    const response = NextResponse.json(
      {
        needsVerification: false,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role
        }
      },
      { status: 201 }
    );

    response.cookies.set(SESSION_COOKIE, createSessionToken(user), sessionCookieOptions());

    return response;
  } catch (registerError) {
    if (createdUserId) {
      await prisma.user.delete({ where: { id: createdUserId } }).catch(() => undefined);
    }

    if (isUniqueConstraint(registerError)) {
      return jsonError("邮箱已存在。", 409);
    }

    return jsonError(
      registerError instanceof Error ? registerError.message : "注册失败。",
      400
    );
  }
}
