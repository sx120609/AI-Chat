import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, requireActiveUser } from "@/lib/http";
import { notificationToView } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const currentUser = await getUserFromRequest(request);
  const error = requireActiveUser(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  const notifications = await prisma.userNotification.findMany({
    where: { userId: currentUser.id },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  const unreadCount = await prisma.userNotification.count({
    where: {
      userId: currentUser.id,
      readAt: null
    }
  });

  return NextResponse.json({
    notifications: notifications.map(notificationToView),
    unreadCount
  });
}
