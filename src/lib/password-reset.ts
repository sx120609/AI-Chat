import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { sendSmtpMail, type SmtpSettings } from "@/lib/smtp";

const PASSWORD_RESET_TOKEN_BYTES = 32;
const PASSWORD_RESET_TTL_MS = 1000 * 60 * 30;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createPasswordResetToken(userId: string) {
  const token = randomBytes(PASSWORD_RESET_TOKEN_BYTES).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

  await prisma.passwordResetToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt
    }
  });

  return token;
}

export async function findUsablePasswordResetToken(token: string) {
  const tokenHash = hashToken(token.trim());
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          active: true
        }
      }
    }
  });

  if (!record || record.usedAt) {
    return { ok: false as const, message: "重置链接无效或已经使用过。" };
  }

  if (record.expiresAt.getTime() < Date.now()) {
    return { ok: false as const, message: "重置链接已过期，请重新发送邮件。" };
  }

  if (!record.user.active) {
    return { ok: false as const, message: "账号已停用，无法重置密码。" };
  }

  return { ok: true as const, record };
}

export async function markPasswordResetTokenUsed(id: string) {
  await prisma.passwordResetToken.update({
    where: { id },
    data: { usedAt: new Date() }
  });
}

export async function sendPasswordResetEmail({
  resetUrl,
  settings,
  siteName,
  to
}: {
  resetUrl: string;
  settings: SmtpSettings;
  siteName: string;
  to: string;
}) {
  const subject = `${siteName} 重置密码`;
  const text = [
    `你正在重置 ${siteName} 的登录密码。`,
    "",
    resetUrl,
    "",
    "这个链接 30 分钟内有效。如果不是你本人操作，可以忽略这封邮件。"
  ].join("\n");
  const html = `
    <div style="font-family:Arial,'Microsoft YaHei',sans-serif;line-height:1.7;color:#2f2a25">
      <p>你正在重置 <strong>${siteName}</strong> 的登录密码。</p>
      <p>
        <a href="${resetUrl}" style="display:inline-block;border-radius:8px;background:#c96442;color:#fff;padding:10px 16px;text-decoration:none;font-weight:600">
          重置密码
        </a>
      </p>
      <p style="color:#746b62;font-size:13px">如果按钮不可用，请复制下面的链接到浏览器打开：</p>
      <p style="word-break:break-all;color:#746b62;font-size:13px">${resetUrl}</p>
      <p style="color:#746b62;font-size:13px">这个链接 30 分钟内有效。如果不是你本人操作，可以忽略这封邮件。</p>
    </div>
  `;

  await sendSmtpMail(settings, {
    to,
    subject,
    text,
    html
  });
}
