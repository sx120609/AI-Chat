import { NextRequest, NextResponse } from "next/server";
import { deleteAttachmentFiles } from "@/lib/attachments";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, readJson, requireActiveUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type DataControlBody = {
  action?: "archive_chats" | "delete_chats" | "deactivate_account";
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

    return NextResponse.json({ action: body.action, affected: 1 });
  }

  return jsonError("未知的数据控制操作。", 400);
}
