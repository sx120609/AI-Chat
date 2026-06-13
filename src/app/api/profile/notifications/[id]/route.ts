import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, readJson, requireActiveUser } from "@/lib/http";
import { notificationToView } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type NotificationBody = {
  read?: boolean;
};

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const currentUser = await getUserFromRequest(request);
  const error = requireActiveUser(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  let body: NotificationBody;

  try {
    body = await readJson<NotificationBody>(request);
  } catch (readError) {
    return jsonError(readError instanceof Error ? readError.message : "更新通知失败。", 400);
  }

  if (typeof body.read !== "boolean") {
    return jsonError("没有可更新的通知状态。", 400);
  }

  const { id } = await context.params;
  const existing = await prisma.userNotification.findFirst({
    where: {
      id,
      userId: currentUser.id
    },
    select: { id: true }
  });

  if (!existing) {
    return jsonError("通知不存在。", 404);
  }

  const notification = await prisma.userNotification.update({
    where: { id },
    data: {
      readAt: body.read ? new Date() : null
    }
  });

  return NextResponse.json({ notification: notificationToView(notification) });
}

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
  const deleted = await prisma.userNotification.deleteMany({
    where: {
      id,
      userId: currentUser.id
    }
  });

  if (deleted.count === 0) {
    return jsonError("通知不存在。", 404);
  }

  return NextResponse.json({ id });
}
