import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, readJson, requireActiveUser } from "@/lib/http";
import { getChatModel, isChatModel } from "@/lib/models";
import { prisma } from "@/lib/prisma";
import { normalizePromptClock } from "@/lib/system-prompt";
import { planMessageTools } from "@/lib/tool-router";
import { assertUpstreamConfigured, getAiRuntimeSettings } from "@/lib/upstream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RoutePlanBody = {
  attachmentIds?: string[];
  clientDate?: string;
  clientTime?: string;
  clientTimeZone?: string;
  content?: string;
  imageToolRequested?: boolean;
  model?: string;
  reuseUserMessageId?: string;
  sourceImageMessageId?: string;
  useWebSearch?: boolean;
};

function uniqueAttachmentIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.filter((item): item is string => typeof item === "string"))].slice(
    0,
    20
  );
}

export async function POST(request: NextRequest) {
  const user = await getUserFromRequest(request);
  const authError = requireActiveUser(user);

  if (!user) {
    return jsonError("请先登录。", 401);
  }

  if (authError) {
    return authError;
  }

  let body: RoutePlanBody;

  try {
    body = await readJson<RoutePlanBody>(request);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "工具路由失败。", 400);
  }

  const aiSettings = await getAiRuntimeSettings();

  try {
    assertUpstreamConfigured(aiSettings);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "上游 API 未配置。", 500);
  }

  if (!isChatModel(body.model, aiSettings.chatModels)) {
    return jsonError("模型不在允许列表中。", 400);
  }

  const model = getChatModel(body.model, aiSettings.chatModels);
  const reusedUserMessage = body.reuseUserMessageId
    ? await prisma.message.findFirst({
        where: {
          id: body.reuseUserMessageId,
          role: "USER",
          conversation: {
            userId: user.id
          }
        },
        include: {
          attachments: true
        }
      })
    : null;

  if (body.reuseUserMessageId && !reusedUserMessage) {
    return jsonError("要继续的用户消息不存在。", 404);
  }

  const attachmentIds = reusedUserMessage ? [] : uniqueAttachmentIds(body.attachmentIds);
  const content =
    body.content?.trim() ||
    reusedUserMessage?.content ||
    (attachmentIds.length ? "请根据我上传的附件进行分析。" : "");

  if (!content) {
    return jsonError("消息不能为空。", 400);
  }

  const attachments = attachmentIds.length
    ? await prisma.attachment.findMany({
        where: {
          id: { in: attachmentIds },
          userId: user.id
        },
        select: {
          id: true,
          kind: true,
          messageId: true
        }
      })
    : [];

  if (attachments.length !== attachmentIds.length) {
    return jsonError("部分附件不存在或无权访问。", 404);
  }

  if (attachments.some((attachment) => attachment.messageId)) {
    return jsonError("部分附件已被发送，请重新上传后再试。", 400);
  }

  const effectiveAttachments = reusedUserMessage ? reusedUserMessage.attachments : attachments;
  const promptClock = normalizePromptClock({
    date: body.clientDate,
    time: body.clientTime,
    timeZone: body.clientTimeZone
  });
  const plan = await planMessageTools({
    attachmentCount: effectiveAttachments.length,
    forceSearch: body.useWebSearch === true,
    hasImageAttachment: effectiveAttachments.some((attachment) => attachment.kind === "IMAGE"),
    imageToolRequested: Boolean(body.imageToolRequested || reusedUserMessage?.mode === "IMAGE"),
    modelId: model.id,
    prompt: content,
    promptClock,
    settings: aiSettings,
    signal: request.signal,
    sourceImageSelected: Boolean(body.sourceImageMessageId)
  });

  return NextResponse.json({ plan });
}
