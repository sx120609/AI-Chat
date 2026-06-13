import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
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

  const updated = await prisma.userNotification.updateMany({
    where: {
      userId: currentUser.id,
      readAt: null
    },
    data: {
      readAt: new Date()
    }
  });

  return NextResponse.json({ updated: updated.count });
}
