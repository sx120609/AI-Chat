import { parsePersonalizationSettings } from "@/lib/personalization";
import { prisma } from "@/lib/prisma";
import { getUsageSummary, type UsageSummary } from "@/lib/quota";
import { normalizeSiteName, normalizeSiteUrl } from "@/lib/site-settings";
import { normalizeSmtpSettings, sendSmtpMail } from "@/lib/smtp";

export type UserNotificationType =
  | "api_key_usage"
  | "balance_low"
  | "task_complete"
  | "task_failed";

type NotificationPreferenceKey = "apiKeyUsage" | "balanceLow" | "taskComplete";

type NotificationLike = {
  body: string;
  createdAt: Date;
  emailedAt: Date | null;
  id: string;
  metadataJson: string;
  readAt: Date | null;
  title: string;
  type: string;
  userId: string;
};

const NOTIFICATION_PREFERENCE_BY_TYPE: Record<UserNotificationType, NotificationPreferenceKey> = {
  api_key_usage: "apiKeyUsage",
  balance_low: "balanceLow",
  task_complete: "taskComplete",
  task_failed: "taskComplete"
};

const LOW_BALANCE_THRESHOLD = 0.15;
const LOW_BALANCE_DEDUPE_MS = 24 * 60 * 60 * 1000;
const API_KEY_USAGE_DEDUPE_MS = 24 * 60 * 60 * 1000;
const API_KEY_UNUSUAL_IDLE_MS = 30 * 24 * 60 * 60 * 1000;

function safeJsonParse(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;

    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function stringifyMetadata(metadata: Record<string, unknown> | undefined) {
  try {
    return JSON.stringify(metadata ?? {}).slice(0, 4000);
  } catch {
    return "{}";
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function notificationToView(notification: NotificationLike) {
  return {
    id: notification.id,
    userId: notification.userId,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    metadata: safeJsonParse(notification.metadataJson),
    readAt: notification.readAt?.toISOString() ?? null,
    emailedAt: notification.emailedAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString()
  };
}

async function sendNotificationEmail({
  body,
  title,
  to
}: {
  body: string;
  title: string;
  to: string;
}) {
  const settings = await prisma.aiSettings.findUnique({
    where: { id: "default" }
  });
  const smtpSettings = normalizeSmtpSettings({
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

  if (!smtpSettings.smtpEnabled) {
    return false;
  }

  const siteName = normalizeSiteName(settings?.siteName || process.env.SITE_NAME);
  const siteUrl = normalizeSiteUrl(settings?.siteUrl || process.env.SITE_URL);
  const profileUrl = siteUrl ? `${siteUrl.replace(/\/$/, "")}/profile` : "";
  const text = [title, "", body, profileUrl ? `查看通知：${profileUrl}` : ""]
    .filter(Boolean)
    .join("\n");
  const html = `
    <div style="font-family:Arial,'Microsoft YaHei',sans-serif;line-height:1.7;color:#2f2a25">
      <p style="font-size:16px;font-weight:700">${escapeHtml(title)}</p>
      <p>${escapeHtml(body)}</p>
      ${
        profileUrl
          ? `<p><a href="${escapeHtml(profileUrl)}" style="color:#0f766e;text-decoration:none;font-weight:600">查看个人中心通知</a></p>`
          : ""
      }
    </div>
  `;

  await sendSmtpMail(smtpSettings, {
    to,
    subject: `${siteName} 通知：${title}`,
    text,
    html
  });

  return true;
}

export async function createUserNotification({
  body,
  metadata,
  respectPreferences = true,
  title,
  type,
  userId
}: {
  body: string;
  metadata?: Record<string, unknown>;
  respectPreferences?: boolean;
  title: string;
  type: UserNotificationType;
  userId: string;
}) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      active: true,
      aiStylePrompt: true,
      email: true,
      id: true
    }
  });

  if (!user?.active) {
    return null;
  }

  const personalization = parsePersonalizationSettings(user.aiStylePrompt);
  const preferenceKey = NOTIFICATION_PREFERENCE_BY_TYPE[type];

  if (respectPreferences && !personalization.notifications[preferenceKey]) {
    return null;
  }

  const notification = await prisma.userNotification.create({
    data: {
      userId,
      type,
      title: title.slice(0, 120),
      body: body.slice(0, 1000),
      metadataJson: stringifyMetadata(metadata)
    }
  });

  if (personalization.notifications.email) {
    try {
      const sent = await sendNotificationEmail({
        body: notification.body,
        title: notification.title,
        to: user.email
      });

      if (sent) {
        return prisma.userNotification.update({
          where: { id: notification.id },
          data: { emailedAt: new Date() }
        });
      }
    } catch {
      // Notification delivery should not break the user action that produced it.
    }
  }

  return notification;
}

export async function maybeNotifyLowBalance(userId: string, summary?: UsageSummary) {
  const usage = summary ?? (await getUsageSummary(userId, { readCache: false }));

  if (usage.monthlyCostLimitCents <= 0) {
    return null;
  }

  const ratio = usage.remainingCostCents / usage.monthlyCostLimitCents;

  if (ratio > LOW_BALANCE_THRESHOLD) {
    return null;
  }

  const recent = await prisma.userNotification.findFirst({
    where: {
      userId,
      type: "balance_low",
      createdAt: {
        gte: new Date(Date.now() - LOW_BALANCE_DEDUPE_MS)
      }
    },
    select: { id: true }
  });

  if (recent) {
    return null;
  }

  return createUserNotification({
    userId,
    type: "balance_low",
    title: "余额不足提醒",
    body: `本月可用余额已低于 15%，当前剩余 ${(usage.remainingCostCents / 100).toFixed(2)} 元。`,
    metadata: {
      costUsedCents: usage.costUsedCents,
      monthlyCostLimitCents: usage.monthlyCostLimitCents,
      remainingCostCents: usage.remainingCostCents,
      threshold: LOW_BALANCE_THRESHOLD,
      windowStart: usage.windowStart
    }
  });
}

export async function notifyApiKeyUsage({
  apiKeyId,
  keyName,
  keyPrefix,
  previousLastUsedAt,
  userId
}: {
  apiKeyId: string;
  keyName: string;
  keyPrefix: string;
  previousLastUsedAt?: Date | null;
  userId: string;
}) {
  const reason = previousLastUsedAt
    ? Date.now() - previousLastUsedAt.getTime() >= API_KEY_UNUSUAL_IDLE_MS
      ? "long_inactive"
      : ""
    : "first_use";

  if (!reason) {
    return null;
  }

  const recent = await prisma.userNotification.findFirst({
    where: {
      userId,
      type: "api_key_usage",
      metadataJson: {
        contains: `"apiKeyId":"${apiKeyId}"`
      },
      createdAt: {
        gte: new Date(Date.now() - API_KEY_USAGE_DEDUPE_MS)
      }
    },
    select: { id: true }
  });

  if (recent) {
    return null;
  }

  return createUserNotification({
    userId,
    type: "api_key_usage",
    title: "API Key 使用提醒",
    body: previousLastUsedAt
      ? `你的个人 API Key「${keyName}」在长时间未使用后刚刚被外部 API 使用。上次使用时间为 ${previousLastUsedAt.toLocaleString("zh-CN")}。`
      : `你的个人 API Key「${keyName}」刚刚首次被外部 API 使用。`,
    metadata: {
      apiKeyId,
      keyName,
      keyPrefix,
      previousLastUsedAt: previousLastUsedAt?.toISOString() ?? null,
      reason
    }
  });
}

export async function notifyTaskFinished({
  conversationId,
  error,
  taskId,
  taskTitle,
  userId
}: {
  conversationId?: string;
  error?: string;
  taskId: string;
  taskTitle: string;
  userId: string;
}) {
  return createUserNotification({
    userId,
    type: error ? "task_failed" : "task_complete",
    title: error ? "任务运行失败" : "任务已完成",
    body: error ? `任务「${taskTitle}」运行失败：${error}` : `任务「${taskTitle}」已运行完成，并生成了聊天结果。`,
    metadata: {
      conversationId: conversationId ?? null,
      error: error ?? null,
      taskId,
      taskTitle
    }
  });
}
