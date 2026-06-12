import { readAttachmentBuffer } from "@/lib/attachments";
import { sanitizeIdentityLeak } from "@/lib/identity";
import { MESSAGE_ORDER_ASC } from "@/lib/message-order";
import { prisma } from "@/lib/prisma";
import { parseWebSourcesJson } from "@/lib/web-search";
import type { AttachmentKind, AttachmentView, SharedConversationView } from "@/types/gateway";

export const SHARE_TOKEN_BYTES = 18;
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;

type SharedAttachment = {
  id: string;
  kind: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
};

type ShareableMessageRole = "USER" | "ASSISTANT";

export function isValidShareToken(token: string) {
  return SHARE_TOKEN_PATTERN.test(token);
}

export function publicAttachmentUrl(token: string, attachmentId: string) {
  return `/api/share/${encodeURIComponent(token)}/attachments/${encodeURIComponent(attachmentId)}`;
}

function attachmentToSharedView(token: string, attachment: SharedAttachment): AttachmentView {
  const kind = attachment.kind as AttachmentKind;

  return {
    id: attachment.id,
    kind,
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    previewUrl: kind === "IMAGE" ? publicAttachmentUrl(token, attachment.id) : undefined,
    createdAt: attachment.createdAt.toISOString()
  };
}

function isShareableMessageRole(role: string): role is ShareableMessageRole {
  return role === "USER" || role === "ASSISTANT";
}

export async function getSharedConversation(token: string): Promise<SharedConversationView | null> {
  if (!isValidShareToken(token)) {
    return null;
  }

  const share = await prisma.conversationShare.findUnique({
    where: { token },
    select: {
      createdAt: true,
      conversation: {
        select: {
          id: true,
          title: true,
          model: true,
          mode: true,
          createdAt: true,
          updatedAt: true,
          messages: {
            select: {
              id: true,
              conversationId: true,
              role: true,
              content: true,
              imageUrl: true,
              webSourcesJson: true,
              model: true,
              mode: true,
              createdAt: true,
              attachments: {
                select: {
                  id: true,
                  kind: true,
                  originalName: true,
                  mimeType: true,
                  sizeBytes: true,
                  createdAt: true
                }
              }
            },
            orderBy: MESSAGE_ORDER_ASC
          }
        }
      }
    }
  });

  if (!share) {
    return null;
  }

  const conversation = share.conversation;
  const messages = conversation.messages
    .filter((message) => isShareableMessageRole(message.role))
    .filter(
      (message) =>
        Boolean(message.content.trim()) ||
        Boolean(message.imageUrl) ||
        message.attachments.length > 0
    )
    .map((message) => ({
      id: message.id,
      conversationId: message.conversationId,
      role: message.role as ShareableMessageRole,
      content:
        message.role === "ASSISTANT"
          ? sanitizeIdentityLeak(message.content, message.model || conversation.model)
          : message.content,
      imageUrl: message.imageUrl,
      model: message.model,
      mode: message.mode,
      attachments: message.attachments.map((attachment) =>
        attachmentToSharedView(token, attachment)
      ),
      webSources: parseWebSourcesJson(message.webSourcesJson),
      createdAt: message.createdAt.toISOString()
    }));

  return {
    id: conversation.id,
    title: conversation.title,
    model: conversation.model,
    mode: conversation.mode,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    sharedAt: share.createdAt.toISOString(),
    messages
  };
}

export async function getSharedAttachment(token: string, attachmentId: string) {
  if (!isValidShareToken(token)) {
    return null;
  }

  const share = await prisma.conversationShare.findUnique({
    where: { token },
    select: { conversationId: true }
  });

  if (!share) {
    return null;
  }

  const attachment = await prisma.attachment.findFirst({
    where: {
      id: attachmentId,
      conversationId: share.conversationId,
      kind: "IMAGE"
    }
  });

  if (!attachment) {
    return null;
  }

  const buffer = await readAttachmentBuffer(attachment).catch(() => null);

  if (!buffer) {
    return null;
  }

  return {
    attachment,
    buffer
  };
}
