import { NextRequest, NextResponse } from "next/server";
import { deleteAttachmentFiles } from "@/lib/attachments";
import {
  getUserFromRequest,
  recordAuthEvent,
  SESSION_COOKIE,
  sessionCookieOptions
} from "@/lib/auth";
import { jsonError, readJson, requireActiveUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type DataControlBody = {
  action?: "archive_chats" | "delete_account" | "delete_chats" | "deactivate_account";
};

export async function POST(request: NextRequest) {
  const currentUser = await getUserFromRequest(request);
  const error = requireActiveUser(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  let body: DataControlBody;

  try {
    body = await readJson<DataControlBody>(request);
  } catch (readError) {
    return jsonError(readError instanceof Error ? readError.message : "数据控制操作失败。", 400);
  }

  if (body.action === "archive_chats") {
    const archived = await prisma.conversation.updateMany({
      where: {
        userId: currentUser.id,
        archivedAt: null
      },
      data: {
        archivedAt: new Date()
      }
    });

    return NextResponse.json({ action: body.action, affected: archived.count });
  }

  if (body.action === "delete_chats") {
    const conversations = await prisma.conversation.findMany({
      where: { userId: currentUser.id },
      select: {
        id: true,
        attachments: {
          select: { storagePath: true }
        }
      }
    });
    const deleted = await prisma.conversation.deleteMany({
      where: { userId: currentUser.id }
    });

    await deleteAttachmentFiles(conversations.flatMap((conversation) => conversation.attachments));

    return NextResponse.json({ action: body.action, affected: deleted.count });
  }

  if (body.action === "deactivate_account") {
    await prisma.user.update({
      where: { id: currentUser.id },
      data: { active: false }
    });
    await prisma.userSession.updateMany({
      where: { userId: currentUser.id, revokedAt: null },
      data: {
        revokedAt: new Date(),
        revokedReason: "account_deactivated"
      }
    });
    await recordAuthEvent({
      email: currentUser.email,
      message: "用户停用自己的账号。",
      request,
      success: true,
      type: "account_deactivated",
      userId: currentUser.id
    });

    const response = NextResponse.json({ action: body.action, affected: 1 });

    response.cookies.set(SESSION_COOKIE, "", {
      ...sessionCookieOptions(),
      maxAge: 0
    });

    return response;
  }

  if (body.action === "delete_account") {
    const attachments = await prisma.attachment.findMany({
      where: { userId: currentUser.id },
      select: { storagePath: true }
    });

    await recordAuthEvent({
      email: currentUser.email,
      message: "用户删除自己的账号。",
      request,
      success: true,
      type: "account_deleted",
      userId: currentUser.id
    });
    await prisma.user.delete({
      where: { id: currentUser.id }
    });
    await deleteAttachmentFiles(attachments);

    const response = NextResponse.json({ action: body.action, affected: 1 });

    response.cookies.set(SESSION_COOKIE, "", {
      ...sessionCookieOptions(),
      maxAge: 0
    });

    return response;
  }

  return jsonError("未知的数据控制操作。", 400);
}
