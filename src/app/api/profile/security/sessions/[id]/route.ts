import { NextRequest, NextResponse } from "next/server";
import {
  getUserFromRequest,
  recordAuthEvent,
  SESSION_COOKIE,
  sessionCookieOptions
} from "@/lib/auth";
import { jsonError, requireActiveUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function DELETE(request: NextRequest, context: RouteContext) {
  const currentUser = await getUserFromRequest(request);
  const error = requireActiveUser(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  const { id } = await context.params;
  const session = await prisma.userSession.findFirst({
    where: {
      id,
      userId: currentUser.id
    }
  });

  if (!session) {
    return jsonError("登录设备不存在。", 404);
  }

  if (!session.revokedAt) {
    await prisma.userSession.update({
      where: { id: session.id },
      data: {
        revokedAt: new Date(),
        revokedReason: session.id === currentUser.sessionId ? "self_revoked" : "device_revoked"
      }
    });
  }

  await recordAuthEvent({
    email: currentUser.email,
    message: session.id === currentUser.sessionId ? "撤销当前登录设备。" : "撤销一个登录设备。",
    request,
    success: true,
    type: "session_revoked",
    userId: currentUser.id
  });

  const response = NextResponse.json({ ok: true, current: session.id === currentUser.sessionId });

  if (session.id === currentUser.sessionId) {
    response.cookies.set(SESSION_COOKIE, "", {
      ...sessionCookieOptions(),
      maxAge: 0
    });
  }

  return response;
}
