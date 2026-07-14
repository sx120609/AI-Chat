import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeUserGroup } from "@/lib/user-groups";

export const SESSION_COOKIE = "team_ai_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

type SessionPayload = {
  sid?: string;
  sub: string;
  role: "USER" | "ADMIN";
  exp: number;
};

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: "USER" | "ADMIN";
  userGroup: string;
  active: boolean;
  emailVerified: boolean;
  aiStylePrompt: string;
  aiPointsBalanceCents: number;
  codingPlanExpiresAt: Date | null;
  codingPlanId: string;
  codingPlanMonthlyCostLimitCents: number;
  codingPlanName: string;
  codingPlanPersonalApiEnabled: boolean;
  monthlyCostLimitCents: number;
  quotaNextResetAt: Date;
  quotaResetAt: Date;
  sessionId?: string;
};

type CurrentUserRecord = {
  active?: boolean | null;
  aiStylePrompt?: string | null;
  email: string;
  emailVerified?: boolean | null;
  id: string;
  aiPointsBalanceCents?: number | null;
  codingPlanExpiresAt?: Date | null;
  codingPlanId?: string | null;
  codingPlanMonthlyCostLimitCents?: number | null;
  codingPlanName?: string | null;
  codingPlanPersonalApiEnabled?: boolean | null;
  monthlyCostLimitCents?: number | null;
  name: string;
  quotaNextResetAt?: Date | null;
  quotaResetAt?: Date | null;
  role: "USER" | "ADMIN";
  userGroup?: string | null;
};

function normalizeCurrentUserRecord(
  user: CurrentUserRecord | null,
  sessionId?: string
): CurrentUser | null {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    userGroup: user.userGroup || (user.role === "ADMIN" ? "VIP" : "NORMAL"),
    active: user.active ?? true,
    emailVerified: user.emailVerified ?? true,
    aiStylePrompt: user.aiStylePrompt || "",
    aiPointsBalanceCents: user.aiPointsBalanceCents ?? 0,
    codingPlanExpiresAt: user.codingPlanExpiresAt ?? null,
    codingPlanId: user.codingPlanId ?? "",
    codingPlanMonthlyCostLimitCents: user.codingPlanMonthlyCostLimitCents ?? 0,
    codingPlanName: user.codingPlanName ?? "",
    codingPlanPersonalApiEnabled: user.codingPlanPersonalApiEnabled ?? false,
    monthlyCostLimitCents: user.monthlyCostLimitCents ?? 0,
    quotaNextResetAt: user.quotaNextResetAt || new Date(),
    quotaResetAt: user.quotaResetAt || new Date(),
    sessionId
  };
}

function requestUserAgent(request?: NextRequest | null) {
  return request?.headers.get("user-agent")?.trim().slice(0, 500) || "";
}

export function describeUserAgent(userAgent: string) {
  const normalized = userAgent.toLowerCase();
  const os = normalized.includes("windows")
    ? "Windows"
    : normalized.includes("android")
      ? "Android"
      : normalized.includes("iphone")
        ? "iPhone"
        : normalized.includes("ipad")
          ? "iPad"
          : normalized.includes("mac os") || normalized.includes("macintosh")
            ? "macOS"
            : normalized.includes("linux")
              ? "Linux"
              : "未知设备";
  const browser = normalized.includes("edg/")
    ? "Edge"
    : normalized.includes("firefox/")
      ? "Firefox"
      : normalized.includes("chrome/")
        ? "Chrome"
        : normalized.includes("safari/")
          ? "Safari"
          : "浏览器";

  return `${os} · ${browser}`;
}

function base64UrlEncode(value: string | Buffer) {
  return Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64UrlDecode(value: string) {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  return Buffer.from(padded.replaceAll("-", "+").replaceAll("_", "/"), "base64");
}

function getAuthSecret() {
  const secret = process.env.AUTH_SECRET;

  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET must be set in production.");
  }

  return secret || "development-only-auth-secret";
}

function sign(value: string) {
  return base64UrlEncode(createHmac("sha256", getAuthSecret()).update(value).digest());
}

export async function recordAuthEvent({
  email = "",
  message = "",
  request,
  success,
  type,
  userId
}: {
  email?: string;
  message?: string;
  request?: NextRequest | null;
  success: boolean;
  type: string;
  userId?: string | null;
}) {
  await prisma.authEvent
    .create({
      data: {
        email: email.trim().toLowerCase().slice(0, 254),
        message: message.slice(0, 500),
        success,
        type,
        userAgent: requestUserAgent(request),
        userId: userId || null
      }
    })
    .catch(() => undefined);
}

export async function createSessionToken(
  user: { id: string; role: "USER" | "ADMIN" },
  request?: NextRequest | null
) {
  const now = new Date();
  const userAgent = requestUserAgent(request);
  const session = await prisma.userSession.create({
    data: {
      userId: user.id,
      userAgent,
      deviceLabel: describeUserAgent(userAgent),
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000)
    },
    select: { id: true }
  });
  const payload: SessionPayload = {
    sid: session.id,
    sub: user.id,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS
  };
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(body);

  return `${body}.${signature}`;
}

export function verifySessionToken(token: string | undefined): SessionPayload | null {
  if (!token) {
    return null;
  }

  const [body, signature] = token.split(".");

  if (!body || !signature) {
    return null;
  }

  const expected = sign(body);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(body).toString("utf8")) as SessionPayload;

    if (!payload.sub || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS
  };
}

async function resolveSessionUser(
  session: SessionPayload | null,
  request?: NextRequest | null
): Promise<CurrentUser | null> {
  if (!session) {
    return null;
  }

  if (!session.sid) {
    const user = await prisma.user.findUnique({
      where: { id: session.sub }
    });

    return normalizeCurrentUserRecord(user);
  }

  const sessionRecord = await prisma.userSession.findUnique({
    where: { id: session.sid },
    include: { user: true }
  });

  if (
    !sessionRecord ||
    sessionRecord.userId !== session.sub ||
    sessionRecord.revokedAt ||
    sessionRecord.expiresAt.getTime() < Date.now()
  ) {
    return null;
  }

  const userAgent = requestUserAgent(request);
  const shouldTouch =
    Date.now() - sessionRecord.lastSeenAt.getTime() > 1000 * 60 * 5 ||
    (userAgent && userAgent !== sessionRecord.userAgent);

  if (shouldTouch) {
    await prisma.userSession
      .update({
        where: { id: sessionRecord.id },
        data: {
          lastSeenAt: new Date(),
          ...(userAgent
            ? {
                userAgent,
                deviceLabel: describeUserAgent(userAgent)
              }
            : {})
        }
      })
      .catch(() => undefined);
  }

  return normalizeCurrentUserRecord(sessionRecord.user, sessionRecord.id);
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const session = verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);

  return resolveSessionUser(session);
}

export async function getUserFromRequest(request: NextRequest): Promise<CurrentUser | null> {
  const session = verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  return resolveSessionUser(session, request);
}

export function serializeCurrentUser(user: CurrentUser) {
  return {
    ...user,
    userGroup: normalizeUserGroup(user.userGroup),
    codingPlanActive: Boolean(
      user.codingPlanExpiresAt &&
        user.codingPlanExpiresAt > new Date() &&
        user.codingPlanMonthlyCostLimitCents > 0
    ),
    codingPlanExpiresAt: user.codingPlanExpiresAt?.toISOString() ?? null,
    quotaNextResetAt: user.quotaNextResetAt.toISOString(),
    quotaResetAt: user.quotaResetAt.toISOString()
  };
}
