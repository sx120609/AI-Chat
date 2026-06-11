import { NextRequest, NextResponse } from "next/server";
import { attachmentToView, contentWithAttachmentContext, deleteAttachmentFiles } from "@/lib/attachments";
import { ensureAttachmentsText } from "@/lib/attachment-repair";
import { getUserFromRequest } from "@/lib/auth";
import { buildContextMessages } from "@/lib/context-window";
import { jsonError, readJson, requireActiveUser } from "@/lib/http";
import { sanitizeReasoningContent } from "@/lib/identity";
import { getChatModel } from "@/lib/models";
import { prisma } from "@/lib/prisma";
import { resolveSystemPrompt } from "@/lib/system-prompt";
import { getAiRuntimeSettings } from "@/lib/upstream";
import { parseWebSourcesJson } from "@/lib/web-search";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type UpdateConversationBody = {
  archived?: boolean;
  pinned?: boolean;
  title?: string;
};

function serializeConversation(conversation: {
  archivedAt?: Date | null;
  createdAt: Date;
  pinned?: boolean;
  updatedAt: Date;
}) {
  return {
    ...conversation,
    archivedAt: conversation.archivedAt ? conversation.archivedAt.toISOString() : null,
    createdAt: conversation.createdAt.toISOString(),
    pinned: Boolean(conversation.pinned),
    updatedAt: conversation.updatedAt.toISOString()
  };
}

function messageForClient<T extends { upstreamUsageJson?: string | null; webSourcesJson?: string | null }>(
  message: T
) {
  const view = { ...message };

  delete view.upstreamUsageJson;
  delete view.webSourcesJson;

  return view;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const user = await getUserFromRequest(request);
  const error = requireActiveUser(user);

  if (!user) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  const { id } = await context.params;
  const conversation = await prisma.conversation.findFirst({
    where: {
      id,
      userId: user.id
    },
    include: {
      messages: {
        include: {
          attachments: true
        },
        orderBy: { id: "asc" }
      }
    }
  });

  if (!conversation) {
    return jsonError("会话不存在。", 404);
  }

  const aiSettings = await getAiRuntimeSettings();
  const messages = await Promise.all(
    conversation.messages.map(async (message) => ({
      ...message,
      attachments: await ensureAttachmentsText(message.attachments)
    }))
  );
  const model = getChatModel(conversation.model, aiSettings.chatModels);
  const systemPrompt = resolveSystemPrompt({
    mode: aiSettings.systemPromptMode,
    customSystemPrompt: aiSettings.customSystemPrompt,
    modelSystemPrompt:
      aiSettings.modelSystemPrompts[model.id] || aiSettings.modelSystemPrompts[model.upstreamId],
    modelLabel: model.label
  });
  const previousMessages = messages
    .filter(
      (message) =>
        !message.imageUrl && (message.role === "USER" || message.role === "ASSISTANT")
    )
    .reverse()
    .map((message) => ({
      role: message.role as "USER" | "ASSISTANT",
      content: contentWithAttachmentContext(message.content, message.attachments)
    }));
  const { contextStats } = buildContextMessages({
    previousMessages,
    systemPrompt,
    model,
    longContextThresholdTokens: aiSettings.longContextThresholdTokens
  });

  return NextResponse.json({
    conversation: {
      ...serializeConversation(conversation),
      messages: messages.map((message) => ({
        ...messageForClient(message),
        attachments: message.attachments.map(attachmentToView),
        reasoningContent: message.reasoningContent
          ? sanitizeReasoningContent(message.reasoningContent, message.model || model.label)
          : null,
        webSources: parseWebSourcesJson(message.webSourcesJson),
        createdAt: message.createdAt.toISOString()
      }))
    },
    context: contextStats
  });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const user = await getUserFromRequest(request);
  const error = requireActiveUser(user);

  if (!user) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  const { id } = await context.params;
  const conversation = await prisma.conversation.findFirst({
    where: {
      id,
      userId: user.id
    },
    select: { id: true }
  });

  if (!conversation) {
    return jsonError("会话不存在。", 404);
  }

  let body: UpdateConversationBody;

  try {
    body = await readJson<UpdateConversationBody>(request);
  } catch (readError) {
    return jsonError(readError instanceof Error ? readError.message : "更新会话失败。", 400);
  }

  const data: {
    archivedAt?: Date | null;
    pinned?: boolean;
    title?: string;
  } = {};

  if (typeof body.title === "string") {
    const title = body.title.trim();

    if (!title) {
      return jsonError("会话标题不能为空。", 400);
    }

    data.title = title.slice(0, 80);
  }

  if (typeof body.pinned === "boolean") {
    data.pinned = body.pinned;
  }

  if (typeof body.archived === "boolean") {
    data.archivedAt = body.archived ? new Date() : null;
  }

  if (Object.keys(data).length === 0) {
    return jsonError("没有可更新的内容。", 400);
  }

  const updatedConversation = await prisma.conversation.update({
    where: { id },
    data,
    select: {
      id: true,
      title: true,
      model: true,
      mode: true,
      pinned: true,
      archivedAt: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: { messages: true }
      }
    }
  });

  return NextResponse.json({
    conversation: serializeConversation(updatedConversation)
  });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const user = await getUserFromRequest(request);
  const error = requireActiveUser(user);

  if (!user) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  const { id } = await context.params;
  const conversation = await prisma.conversation.findFirst({
    where: {
      id,
      userId: user.id
    },
    select: {
      id: true,
      attachments: true
    }
  });

  if (!conversation) {
    return jsonError("会话不存在。", 404);
  }

  await prisma.conversation.delete({
    where: { id }
  });

  await deleteAttachmentFiles(conversation.attachments);

  return NextResponse.json({ ok: true });
}
