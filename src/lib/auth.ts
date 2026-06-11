import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const SESSION_COOKIE = "team_ai_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

type SessionPayload = {
  sub: string;
  role: "USER" | "ADMIN";
  exp: number;
};

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: "USER" | "ADMIN";
  active: boolean;
  monthlyCostLimitCents: number;
  quotaResetAt: Date;
};

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

export function createSessionToken(user: { id: string; role: "USER" | "ADMIN" }) {
  const payload: SessionPayload = {
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

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const session = verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);

  if (!session) {
    return null;
  }

  return prisma.user.findUnique({
    where: { id: session.sub },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      active: true,
      monthlyCostLimitCents: true,
      quotaResetAt: true
    }
  });
}

export async function getUserFromRequest(request: NextRequest): Promise<CurrentUser | null> {
  const session = verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  if (!session) {
    return null;
  }

  return prisma.user.findUnique({
    where: { id: session.sub },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      active: true,
      monthlyCostLimitCents: true,
      quotaResetAt: true
    }
  });
}

export function serializeCurrentUser(user: CurrentUser) {
  return {
    ...user,
    quotaResetAt: user.quotaResetAt.toISOString()
  };
}
