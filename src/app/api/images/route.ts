import { NextRequest, NextResponse } from "next/server";
import {
  attachmentToView,
  contentWithAttachmentContext,
  deleteAttachmentFiles,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  readAttachmentBuffer
} from "@/lib/attachments";
import { ensureAttachmentsMetadata } from "@/lib/attachment-repair";
import { resetContextSummaryData } from "@/lib/context-compression";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, readJson, requireActiveUser } from "@/lib/http";
import { messagesAfter } from "@/lib/message-order";
import { estimateImageCostCents } from "@/lib/models";
import { prisma } from "@/lib/prisma";
import { assertQuotaAvailable, getUsageSummary, QuotaError } from "@/lib/quota";
import { compactTitle, estimateTokens } from "@/lib/tokens";
import { assertUpstreamConfigured, generateImage, getAiRuntimeSettings } from "@/lib/upstream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ImageBody = {
  conversationId?: string;
  model?: string;
  prompt?: string;
  size?: string;
  attachmentIds?: string[];
  reuseUserMessageId?: string;
  sourceImageMessageId?: string;
};

function uniqueAttachmentIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.filter((item): item is string => typeof item === "string"))].slice(
    0,
    MAX_ATTACHMENTS_PER_MESSAGE
  );
}

function isPrivateImageHost(hostname: string) {
  const host = hostname.toLowerCase();

  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }

  if (/^(127|10)\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) {
    return true;
  }

  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd")) {
    return true;
  }

  return false;
}

async function sourceImageFromMessageUrl(imageUrl: string) {
  if (imageUrl.startsWith("data:")) {
    const match = imageUrl.match(/^data:([^;,]+);base64,(.+)$/);

    if (!match) {
      throw new Error("源图片格式无效。");
    }

    const buffer = Buffer.from(match[2], "base64");

    if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error("源图片不能超过 50 MB。");
    }

    return {
      buffer,
      mimeType: match[1] || "image/png",
      originalName: "generated-image.png"
    };
  }

  let url: URL;

  try {
    url = new URL(imageUrl);
  } catch {
    throw new Error("源图片地址无效。");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("源图片地址协议无效。");
  }

  if (isPrivateImageHost(url.hostname)) {
    throw new Error("源图片地址不能指向本机或内网。");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(url, {
      headers: {
        accept: "image/*",
        "user-agent": "TeamAIGateway/1.0"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error("源图片下载失败。");
    }

    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";

    if (!mimeType.startsWith("image/")) {
      throw new Error("源图片不是有效图片。");
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error("源图片不能超过 50 MB。");
    }

    const extension = mimeType.split("/")[1] || "png";

    return {
      buffer,
      mimeType,
      originalName: `generated-image.${extension}`
    };
  } finally {
    clearTimeout(timer);
  }
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

  let body: ImageBody;

  try {
    body = await readJson<ImageBody>(request);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "生图失败。", 400);
  }

  const reusedUserMessage = body.reuseUserMessageId
    ? await prisma.message.findFirst({
        where: {
          id: body.reuseUserMessageId,
          role: "USER",
          mode: "IMAGE",
          conversation: {
            userId: user.id
          }
        },
        include: {
          attachments: true,
          conversation: {
            include: {
              _count: {
                select: { messages: true }
              }
            }
          }
        }
      })
    : null;

  if (body.reuseUserMessageId && !reusedUserMessage) {
    return jsonError("要重新生成的图片消息不存在。", 404);
  }

  const attachmentIds = reusedUserMessage ? [] : uniqueAttachmentIds(body.attachmentIds);
  const prompt =
    body.prompt?.trim() ||
    reusedUserMessage?.content ||
    (attachmentIds.length || body.sourceImageMessageId
      ? "请基于这张图片生成新图片。"
      : "");

  if (!prompt) {
    return jsonError("提示词不能为空。", 400);
  }

  const aiSettings = await getAiRuntimeSettings();

  try {
    assertUpstreamConfigured(aiSettings);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "上游 API 未配置。", 500);
  }

  const existingConversation = reusedUserMessage
    ? reusedUserMessage.conversation
    : body.conversationId
      ? await prisma.conversation.findFirst({
          where: {
            id: body.conversationId,
            userId: user.id
          },
          include: {
            _count: {
              select: { messages: true }
            }
          }
        })
    : null;

  if ((body.conversationId || body.reuseUserMessageId) && !existingConversation) {
    return jsonError("会话不存在。", 404);
  }

  const attachments = attachmentIds.length
    ? await ensureAttachmentsMetadata(
        await prisma.attachment.findMany({
          where: {
            id: { in: attachmentIds },
            userId: user.id
          }
        })
      )
    : [];

  if (attachments.length !== attachmentIds.length) {
    return jsonError("部分附件不存在或无权访问。", 404);
  }

  if (attachments.some((attachment) => attachment.messageId)) {
    return jsonError("部分附件已被发送，请重新上传后再试。", 400);
  }

  const effectiveAttachments = reusedUserMessage
    ? await ensureAttachmentsMetadata(reusedUserMessage.attachments)
    : attachments;

  const sourceImageMessage = body.sourceImageMessageId
    ? await prisma.message.findFirst({
        where: {
          id: body.sourceImageMessageId,
          imageUrl: {
            not: null
          },
          conversation: {
            userId: user.id
          }
        },
        select: {
          imageUrl: true
        }
      })
    : null;

  if (body.sourceImageMessageId && !sourceImageMessage?.imageUrl) {
    return jsonError("源图片不存在或无权访问。", 404);
  }

  const promptWithAttachmentContext = contentWithAttachmentContext(prompt, effectiveAttachments);
  const promptTokens = estimateTokens(promptWithAttachmentContext);
  const estimatedCostCents = estimateImageCostCents(promptTokens);

  try {
    await assertQuotaAvailable(user.id, estimatedCostCents);
  } catch (error) {
    if (error instanceof QuotaError) {
      return jsonError(error.message, error.status, { usage: error.summary });
    }

    throw error;
  }

  const conversation =
    existingConversation ??
    (await prisma.conversation.create({
      data: {
        userId: user.id,
        title: compactTitle(prompt),
        model: "image2",
        mode: "IMAGE"
      },
      include: {
        _count: {
          select: { messages: true }
        }
      }
    }));

  if (reusedUserMessage) {
    const laterAttachments = await prisma.attachment.findMany({
      where: {
        message: {
          conversationId: reusedUserMessage.conversationId,
          ...messagesAfter(reusedUserMessage)
        }
      }
    });

    if (laterAttachments.length > 0) {
      await prisma.attachment.deleteMany({
        where: {
          id: {
            in: laterAttachments.map((attachment) => attachment.id)
          }
        }
      });
      await deleteAttachmentFiles(laterAttachments);
    }

    await prisma.message.deleteMany({
      where: {
        conversationId: reusedUserMessage.conversationId,
        ...messagesAfter(reusedUserMessage)
      }
    });

    await prisma.conversation.update({
      where: { id: reusedUserMessage.conversationId },
      data: resetContextSummaryData()
    });
  }

  const userMessage = reusedUserMessage
    ? await prisma.message.update({
        where: { id: reusedUserMessage.id },
        data: {
          content: prompt,
          model: "image2",
          mode: "IMAGE"
        },
        include: { attachments: true }
      })
    : await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: "USER",
          content: prompt,
          model: "image2",
          mode: "IMAGE"
        },
        include: { attachments: true }
      });

  if (!reusedUserMessage && attachments.length > 0) {
    await prisma.attachment.updateMany({
      where: {
        id: { in: attachments.map((attachment) => attachment.id) },
        userId: user.id
      },
      data: {
        conversationId: conversation.id,
        messageId: userMessage.id
      }
    });
  }

  try {
    const sourceImages = await Promise.all(
      [
        ...effectiveAttachments
          .filter((attachment) => attachment.kind === "IMAGE")
          .map(async (attachment) => ({
            buffer: await readAttachmentBuffer(attachment),
            mimeType: attachment.mimeType,
            originalName: attachment.originalName
          })),
        ...(sourceImageMessage?.imageUrl
          ? [sourceImageFromMessageUrl(sourceImageMessage.imageUrl)]
          : [])
      ]
    );
    const imageUrl = await generateImage(promptWithAttachmentContext, body.size || "1024x1024", {
      sourceImages
    });
    const assistantMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: "Image generated",
        imageUrl,
        model: "image2",
        mode: "IMAGE",
        promptTokens,
        totalTokens: promptTokens,
        estimatedCostCents
      }
    });

    await prisma.usageRecord.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        messageId: assistantMessage.id,
        model: "image2",
        mode: "IMAGE",
        promptTokens,
        totalTokens: promptTokens,
        estimatedCostCents
      }
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        mode: conversation._count.messages === 0 ? "IMAGE" : conversation.mode,
        model: conversation._count.messages === 0 ? "image2" : conversation.model,
        title: conversation._count.messages === 0 ? compactTitle(prompt) : conversation.title
      }
    });

    const usage = await getUsageSummary(user.id, { readCache: false });

    return NextResponse.json({
      conversationId: conversation.id,
      userMessage: {
        ...userMessage,
        attachments: effectiveAttachments.map(attachmentToView),
        createdAt: userMessage.createdAt.toISOString()
      },
      assistantMessage: {
        ...assistantMessage,
        createdAt: assistantMessage.createdAt.toISOString()
      },
      usage
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "上游生图失败。", 502);
  }
}
