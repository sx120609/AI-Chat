import { NextRequest, NextResponse } from "next/server";
import { attachmentToView, contentWithAttachmentContext, deleteAttachmentFiles } from "@/lib/attachments";
import { ensureAttachmentsMetadata } from "@/lib/attachment-repair";
import { getUserFromRequest } from "@/lib/auth";
import { buildContextMessages } from "@/lib/context-window";
import { jsonError, readJson, requireActiveUser } from "@/lib/http";
import { sanitizeReasoningContent } from "@/lib/identity";
import { isMessageAfter, MESSAGE_ORDER_ASC } from "@/lib/message-order";
import { messageProcessForClient } from "@/lib/message-process";
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
  projectId?: string | null;
  title?: string;
};

function serializeConversation<
  T extends {
    archivedAt?: Date | null;
    createdAt: Date;
    pinned?: boolean;
    project?: { name: string } | null;
    projectId?: string | null;
    updatedAt: Date;
  }
>(conversation: T) {
  const { archivedAt, project, ...rest } = conversation;

  return {
    ...rest,
    archivedAt: archivedAt?.toISOString() ?? null,
    createdAt: conversation.createdAt.toISOString(),
    pinned: Boolean(conversation.pinned),
    projectId: conversation.projectId ?? null,
    projectName: project?.name ?? null,
    updatedAt: conversation.updatedAt.toISOString()
  };
}

function messageForClient<
  T extends {
    toolEventsJson?: string | null;
    upstreamUsageJson?: string | null;
    webSourcesJson?: string | null;
  }
>(
  message: T
) {
  const view = { ...message };

  delete view.toolEventsJson;
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
  const includeContext = new URL(request.url).searchParams.get("context") === "1";
  const conversation = await prisma.conversation.findFirst({
    where: {
      id,
      userId: user.id
    },
    select: {
      id: true,
      title: true,
      model: true,
      mode: true,
      pinned: true,
      archivedAt: true,
      projectId: true,
      project: {
        select: { name: true }
      },
      createdAt: true,
      updatedAt: true,
      contextSummary: true,
      contextSummaryUntilMessageId: true,
      contextSummaryUntilCreatedAt: true,
      contextSummaryMessageCount: true,
      messages: {
        select: {
          id: true,
          conversationId: true,
          role: true,
          content: true,
          reasoningContent: true,
          imageUrl: true,
          webSourcesJson: true,
          generationStatus: true,
          streamStatus: true,
          toolEventsJson: true,
          processStartedAt: true,
          processFinishedAt: true,
          model: true,
          mode: true,
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          cachedPromptTokens: true,
          reasoningTokens: true,
          usageSource: true,
          estimatedCostCents: true,
          createdAt: true,
          attachments: {
            select: {
              id: true,
              projectId: true,
              kind: true,
              originalName: true,
              mimeType: true,
              sizeBytes: true,
              extractedText: true,
              storagePath: true,
              project: {
                select: { name: true }
              },
              createdAt: true
            }
          }
        },
        orderBy: MESSAGE_ORDER_ASC
      }
    }
  });

  if (!conversation) {
    return jsonError("会话不存在。", 404);
  }

  const messages = includeContext
    ? await Promise.all(
        conversation.messages.map(async (message) => ({
          ...message,
          attachments: await ensureAttachmentsMetadata(message.attachments)
        }))
      )
    : conversation.messages;
  let contextStats: ReturnType<typeof buildContextMessages>["contextStats"] | null = null;
  let reasoningModelLabel = conversation.model;

  if (includeContext) {
    const aiSettings = await getAiRuntimeSettings();
    const model = getChatModel(conversation.model, aiSettings.chatModels);
    const summaryCutoff =
      conversation.contextSummaryUntilCreatedAt && conversation.contextSummaryUntilMessageId
        ? {
            createdAt: conversation.contextSummaryUntilCreatedAt,
            id: conversation.contextSummaryUntilMessageId
          }
        : null;
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
          !message.imageUrl &&
          (message.role === "USER" || message.role === "ASSISTANT") &&
          (!summaryCutoff || isMessageAfter(message, summaryCutoff))
      )
      .reverse()
      .map((message) => ({
        role: message.role as "USER" | "ASSISTANT",
        content: contentWithAttachmentContext(message.content, message.attachments)
      }));
    contextStats = buildContextMessages({
      compressedHistoryMessageCount: conversation.contextSummaryMessageCount,
      contextSummary: conversation.contextSummary || "",
      previousMessages,
      systemPrompt,
      model,
      longContextThresholdTokens: aiSettings.longContextThresholdTokens
    }).contextStats;
    reasoningModelLabel = model.label;
  }

  return NextResponse.json({
    conversation: {
      ...serializeConversation({
        createdAt: conversation.createdAt,
        id: conversation.id,
        mode: conversation.mode,
        model: conversation.model,
        pinned: conversation.pinned,
        project: conversation.project,
        projectId: conversation.projectId,
        title: conversation.title,
        updatedAt: conversation.updatedAt
      }),
      messages: messages.map((message) => ({
        ...messageForClient(message),
        ...messageProcessForClient(message),
        attachments: message.attachments.map(attachmentToView),
        reasoningContent: message.reasoningContent
          ? sanitizeReasoningContent(message.reasoningContent, message.model || reasoningModelLabel)
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
    projectId?: string | null;
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

  if ("projectId" in body) {
    const projectId =
      typeof body.projectId === "string" && body.projectId.trim() ? body.projectId.trim() : null;

    if (projectId) {
      const project = await prisma.userProject.findFirst({
        where: { id: projectId, userId: user.id },
        select: { id: true }
      });

      if (!project) {
        return jsonError("项目不存在。", 404);
      }
    }

    data.projectId = projectId;
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
      projectId: true,
      project: {
        select: { name: true }
      },
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
