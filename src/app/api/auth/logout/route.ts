import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest, recordAuthEvent, SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const currentUser = await getUserFromRequest(request);

  if (currentUser?.sessionId) {
    await prisma.userSession
      .update({
        where: { id: currentUser.sessionId },
        data: {
          revokedAt: new Date(),
          revokedReason: "logout"
        }
      })
      .catch(() => undefined);
  }

  if (currentUser) {
    await recordAuthEvent({
      email: currentUser.email,
      message: "退出登录。",
      request,
      success: true,
      type: "logout",
      userId: currentUser.id
    });
  }

  const response = NextResponse.json({ ok: true });

  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });

  return response;
}
