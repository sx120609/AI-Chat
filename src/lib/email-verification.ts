import { createHash, randomBytes } from "crypto";
import { VERIFICATION_EMAIL_HINT } from "@/lib/email-copy";
import { prisma } from "@/lib/prisma";
import { sendSmtpMail, type SmtpSettings } from "@/lib/smtp";

const EMAIL_VERIFICATION_TOKEN_BYTES = 32;
const EMAIL_VERIFICATION_TTL_MS = 1000 * 60 * 60 * 24;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createEmailVerificationToken(userId: string) {
  const token = randomBytes(EMAIL_VERIFICATION_TOKEN_BYTES).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);

  await prisma.emailVerificationToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt
    }
  });

  return token;
}

export async function verifyEmailToken(token: string) {
  const tokenHash = hashToken(token.trim());
  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash },
    include: { user: true }
  });

  if (!record || record.usedAt) {
    return { ok: false, message: "验证链接无效或已经使用过。" };
  }

  if (record.expiresAt.getTime() < Date.now()) {
    return { ok: false, message: "验证链接已过期，请重新注册或联系管理员。" };
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { emailVerified: true }
    }),
    prisma.emailVerificationToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() }
    })
  ]);

  return { ok: true, message: "邮箱验证完成，可以登录了。", email: record.user.email };
}

export async function sendVerificationEmail({
  settings,
  siteName,
  to,
  verificationUrl
}: {
  settings: SmtpSettings;
  siteName: string;
  to: string;
  verificationUrl: string;
}) {
  const subject = `${siteName} 邮箱验证`;
  const text = [
    `请验证你的 ${siteName} 账号邮箱。`,
    "",
    verificationUrl,
    "",
    VERIFICATION_EMAIL_HINT,
    "",
    "如果不是你本人操作，可以忽略这封邮件。"
  ].join("\n");
  const html = `
    <div style="font-family:Arial,'Microsoft YaHei',sans-serif;line-height:1.7;color:#2f2a25">
      <p>请验证你的 <strong>${siteName}</strong> 账号邮箱。</p>
      <p>
        <a href="${verificationUrl}" style="display:inline-block;border-radius:8px;background:#c96442;color:#fff;padding:10px 16px;text-decoration:none;font-weight:600">
          验证邮箱
        </a>
      </p>
      <p style="color:#746b62;font-size:13px">如果按钮不可用，请复制下面的链接到浏览器打开：</p>
      <p style="word-break:break-all;color:#746b62;font-size:13px">${verificationUrl}</p>
      <p style="color:#746b62;font-size:13px">${VERIFICATION_EMAIL_HINT}</p>
      <p style="color:#746b62;font-size:13px">如果不是你本人操作，可以忽略这封邮件。</p>
    </div>
  `;

  await sendSmtpMail(settings, {
    to,
    subject,
    text,
    html
  });
}
