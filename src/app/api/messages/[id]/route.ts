import { NextRequest, NextResponse } from "next/server";
import { attachmentToView, deleteAttachmentFiles } from "@/lib/attachments";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, readJson, requireActiveUser } from "@/lib/http";
import { messagesAfter } from "@/lib/message-order";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type UpdateMessageBody = {
  content?: string;
};

async function requireOwnedMessage(request: NextRequest, id: string) {
  const user = await getUserFromRequest(request);
  const authError = requireActiveUser(user);

  if (!user) {
    return { error: jsonError("请先登录。", 401) };
  }

  if (authError) {
    return { error: authError };
  }

  const message = await prisma.message.findFirst({
    where: {
      id,
      conversation: {
        userId: user.id
      }
    },
    include: {
      attachments: true,
      conversation: true
    }
  });

  if (!message) {
    return { error: jsonError("消息不存在。", 404) };
  }

  return { message, user };
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const owned = await requireOwnedMessage(request, id);

  if (owned.error) {
    return owned.error;
  }

  const { message } = owned;

  if (message.role !== "USER") {
    return jsonError("只能编辑用户消息。", 400);
  }

  let body: UpdateMessageBody;

  try {
    body = await readJson<UpdateMessageBody>(request);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "编辑失败。", 400);
  }

  const content = body.content?.trim();

  if (!content) {
    return jsonError("消息不能为空。", 400);
  }

  const laterAttachments = await prisma.attachment.findMany({
    where: {
      message: {
        conversationId: message.conversationId,
        ...messagesAfter(message)
      }
    }
  });

  const updatedMessage = await prisma.$transaction(async (tx) => {
    if (laterAttachments.length > 0) {
      await tx.attachment.deleteMany({
        where: {
          id: {
            in: laterAttachments.map((attachment) => attachment.id)
          }
        }
      });
    }

    await tx.message.deleteMany({
      where: {
        conversationId: message.conversationId,
        ...messagesAfter(message)
      }
    });

    await tx.conversation.update({
      where: { id: message.conversationId },
      data: {
        updatedAt: new Date()
      }
    });

    return tx.message.update({
      where: { id: message.id },
      data: { content },
      include: { attachments: true }
    });
  });

  await deleteAttachmentFiles(laterAttachments);

  return NextResponse.json({
    message: {
      ...updatedMessage,
      attachments: updatedMessage.attachments.map(attachmentToView),
      createdAt: updatedMessage.createdAt.toISOString()
    }
  });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const owned = await requireOwnedMessage(request, id);

  if (owned.error) {
    return owned.error;
  }

  const { message } = owned;
  const attachments = message.attachments;

  await prisma.$transaction(async (tx) => {
    if (attachments.length > 0) {
      await tx.attachment.deleteMany({
        where: {
          id: {
            in: attachments.map((attachment) => attachment.id)
          }
        }
      });
    }

    await tx.message.delete({
      where: { id: message.id }
    });

    await tx.conversation.update({
      where: { id: message.conversationId },
      data: {
        updatedAt: new Date()
      }
    });
  });

  await deleteAttachmentFiles(attachments);

  return NextResponse.json({ ok: true });
}
