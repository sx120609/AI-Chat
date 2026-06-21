import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest, recordAuthEvent } from "@/lib/auth";
import { jsonError, requireActiveUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const currentUser = await getUserFromRequest(request);
  const error = requireActiveUser(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  const revoked = await prisma.userSession.updateMany({
    where: {
      userId: currentUser.id,
      revokedAt: null,
      ...(currentUser.sessionId ? { id: { not: currentUser.sessionId } } : {})
    },
    data: {
      revokedAt: new Date(),
      revokedReason: "revoke_others"
    }
  });

  await recordAuthEvent({
    email: currentUser.email,
    message: `已退出其他 ${revoked.count} 个登录设备。`,
    request,
    success: true,
    type: "sessions_revoked",
    userId: currentUser.id
  });

  return NextResponse.json({ affected: revoked.count });
}
