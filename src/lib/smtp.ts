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

type SmtpErrorLike = {
  code?: unknown;
  command?: unknown;
  message?: unknown;
  response?: unknown;
  responseCode?: unknown;
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

export function describeSmtpError(error: unknown) {
  const smtpError = (error ?? {}) as SmtpErrorLike;
  const rawMessage =
    [
      typeof smtpError.response === "string" ? smtpError.response : "",
      typeof smtpError.message === "string" ? smtpError.message : ""
    ]
      .filter(Boolean)
      .join(" ")
      .trim() || "邮件服务返回了未知错误。";
  const message = rawMessage.toLowerCase();
  const code = typeof smtpError.code === "string" ? smtpError.code : "";
  const responseCode =
    typeof smtpError.responseCode === "number" ? smtpError.responseCode : undefined;

  if (code === "EAUTH" || responseCode === 535 || message.includes("authentication")) {
    if (
      message.includes("smtpclientauthentication") ||
      message.includes("smtp auth") ||
      message.includes("disabled")
    ) {
      return "SMTP 登录被服务商拒绝：账号或租户可能没有启用 SMTP AUTH。Microsoft 365 需要在租户和该邮箱上允许 SMTP AUTH；如果开启了 MFA，通常还需要应用专用密码或改用支持的认证方式。";
    }

    return "SMTP 登录失败：服务商拒绝了账号或密码。请确认 SMTP 账号、密码/应用专用密码、MFA 策略，以及该邮箱是否允许 SMTP AUTH。";
  }

  if (message.includes("must issue a starttls command") || responseCode === 530) {
    return "SMTP 服务器要求 STARTTLS。请使用 587 端口，关闭 SSL/TLS，并开启 STARTTLS。";
  }

  if (code === "ESOCKET" || code === "ETIMEDOUT" || message.includes("timeout")) {
    return "无法连接 SMTP 服务器：请检查主机、端口、防火墙，以及服务器是否允许从当前部署机器访问。";
  }

  if (message.includes("self-signed") || message.includes("certificate")) {
    return "SMTP TLS 证书校验失败：请检查 SMTP 主机名是否正确，或服务商证书是否可信。";
  }

  if (responseCode === 550 || responseCode === 553 || message.includes("sender")) {
    return "SMTP 发件人被拒绝：发件邮箱通常需要和登录账号一致，或需要在服务商后台授权代发。";
  }

  return `SMTP 发送失败：${rawMessage}`;
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
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    requireTLS: settings.smtpStartTls && !settings.smtpSecure,
    ignoreTLS: !settings.smtpStartTls && !settings.smtpSecure,
    tls: {
      minVersion: "TLSv1.2",
      servername: settings.smtpHost
    },
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
