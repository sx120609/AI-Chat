import { NextRequest, NextResponse } from "next/server";
import { describeUserAgent, getUserFromRequest } from "@/lib/auth";
import { jsonError, requireActiveUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function serializeSession(
  session: {
    id: string;
    userAgent: string;
    deviceLabel: string;
    createdAt: Date;
    lastSeenAt: Date;
    expiresAt: Date;
    revokedAt: Date | null;
    revokedReason: string;
  },
  currentSessionId?: string
) {
  const now = Date.now();

  return {
    id: session.id,
    active: !session.revokedAt && session.expiresAt.getTime() > now,
    current: session.id === currentSessionId,
    deviceLabel: session.deviceLabel || describeUserAgent(session.userAgent),
    userAgent: session.userAgent,
    createdAt: session.createdAt.toISOString(),
    lastSeenAt: session.lastSeenAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    revokedAt: session.revokedAt?.toISOString() ?? null,
    revokedReason: session.revokedReason
  };
}

function serializeEvent(event: {
  id: string;
  email: string;
  type: string;
  success: boolean;
  message: string;
  userAgent: string;
  createdAt: Date;
}) {
  return {
    id: event.id,
    email: event.email,
    type: event.type,
    success: event.success,
    message: event.message,
    userAgent: event.userAgent,
    deviceLabel: describeUserAgent(event.userAgent),
    createdAt: event.createdAt.toISOString()
  };
}

export async function GET(request: NextRequest) {
  const currentUser = await getUserFromRequest(request);
  const error = requireActiveUser(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  const [sessions, events] = await Promise.all([
    prisma.userSession.findMany({
      where: { userId: currentUser.id },
      orderBy: { lastSeenAt: "desc" },
      take: 20
    }),
    prisma.authEvent.findMany({
      where: { userId: currentUser.id },
      orderBy: { createdAt: "desc" },
      take: 30
    })
  ]);

  return NextResponse.json({
    events: events.map(serializeEvent),
    sessions: sessions.map((session) => serializeSession(session, currentUser.sessionId))
  });
}
