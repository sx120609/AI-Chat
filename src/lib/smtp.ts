import nodemailer from "nodemailer";

export type SmtpSettings = {
  smtpEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
  smtpPassword: string | null;
  smtpFromEmail: string;
  smtpFromName: string;
  smtpSecure: boolean;
  smtpStartTls: boolean;
};

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export function maskSecret(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  return value.length <= 8 ? "已设置" : `...${value.slice(-4)}`;
}

export function normalizeEmail(value: string | null | undefined) {
  const email = value?.trim().toLowerCase() || "";

  if (!email) {
    return "";
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("请输入有效的邮箱地址。");
  }

  return email;
}

export function normalizeSmtpPort(value: unknown) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);

  if (!Number.isFinite(parsed)) {
    return 587;
  }

  return Math.min(65535, Math.max(1, Math.round(parsed)));
}

export function normalizeSmtpHost(value: string | null | undefined) {
  return value?.trim() || "";
}

export function normalizeSmtpName(value: string | null | undefined) {
  return value?.trim().slice(0, 80) || "";
}

export function normalizeSmtpSettings(input: {
  smtpEnabled?: boolean;
  smtpHost?: string | null;
  smtpPort?: unknown;
  smtpUsername?: string | null;
  smtpPassword?: string | null;
  smtpFromEmail?: string | null;
  smtpFromName?: string | null;
  smtpSecure?: boolean;
  smtpStartTls?: boolean;
}): SmtpSettings {
  const smtpEnabled = Boolean(input.smtpEnabled);
  const smtpHost = normalizeSmtpHost(input.smtpHost);
  const smtpPort = normalizeSmtpPort(input.smtpPort);
  const smtpUsername = input.smtpUsername?.trim() || "";
  const smtpPassword = input.smtpPassword?.trim() || null;
  const smtpFromEmail = normalizeEmail(input.smtpFromEmail);
  const smtpFromName = normalizeSmtpName(input.smtpFromName);
  const smtpSecure = Boolean(input.smtpSecure);
  const smtpStartTls = input.smtpStartTls !== false;

  if (smtpEnabled) {
    if (!smtpHost) {
      throw new Error("启用邮件服务前请填写 SMTP 主机。");
    }

    if (!smtpFromEmail) {
      throw new Error("启用邮件服务前请填写发件邮箱。");
    }
  }

  return {
    smtpEnabled,
    smtpHost,
    smtpPort,
    smtpUsername,
    smtpPassword,
    smtpFromEmail,
    smtpFromName,
    smtpSecure,
    smtpStartTls
  };
}

export async function sendSmtpMail(settings: SmtpSettings, message: MailMessage) {
  if (!settings.smtpEnabled) {
    throw new Error("邮件服务未启用。");
  }

  const to = normalizeEmail(message.to);

  if (!to) {
    throw new Error("请输入收件邮箱。");
  }

  const transporter = nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpSecure,
    requireTLS: settings.smtpStartTls && !settings.smtpSecure,
    ignoreTLS: !settings.smtpStartTls && !settings.smtpSecure,
    auth: settings.smtpUsername
      ? {
          user: settings.smtpUsername,
          pass: settings.smtpPassword || ""
        }
      : undefined
  });

  await transporter.sendMail({
    from: settings.smtpFromName
      ? `"${settings.smtpFromName.replaceAll("\"", "'")}" <${settings.smtpFromEmail}>`
      : settings.smtpFromEmail,
    to,
    subject: message.subject,
    text: message.text,
    html: message.html
  });
}
