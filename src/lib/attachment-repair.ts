import {
  extractAttachmentText,
  readAttachmentBuffer,
  validateAttachment
} from "@/lib/attachments";
import { prisma } from "@/lib/prisma";
import type { AttachmentKind } from "@/types/gateway";

type RepairableAttachment = {
  id: string;
  kind: string;
  originalName: string;
  mimeType: string;
  storagePath: string;
  extractedText: string | null;
};

function hasText(text: string | null | undefined) {
  return Boolean(text?.trim());
}

async function repairAttachmentType<T extends RepairableAttachment>(attachment: T) {
  const buffer = await readAttachmentBuffer(attachment);
  const detected = validateAttachment(
    attachment.originalName,
    attachment.mimeType,
    buffer.byteLength,
    buffer
  );

  if (detected.kind === attachment.kind && detected.mimeType === attachment.mimeType) {
    return { attachment, buffer };
  }

  await prisma.attachment
    .update({
      where: { id: attachment.id },
      data: {
        kind: detected.kind,
        mimeType: detected.mimeType
      }
    })
    .catch((error) => {
      console.warn(
        `[attachments] Failed to persist repaired type for ${attachment.originalName}:`,
        error instanceof Error ? error.message : error
      );
    });

  return {
    attachment: {
      ...attachment,
      kind: detected.kind,
      mimeType: detected.mimeType
    },
    buffer
  };
}

export async function ensureAttachmentText<T extends RepairableAttachment>(
  attachment: T
): Promise<T> {
  if (hasText(attachment.extractedText)) {
    return attachment;
  }

  const repaired = await repairAttachmentType(attachment).catch((error) => {
    console.warn(
      `[attachments] Failed to repair type for ${attachment.originalName}:`,
      error instanceof Error ? error.message : error
    );
    return null;
  });

  const nextAttachment = repaired?.attachment ?? attachment;

  if (nextAttachment.kind === "IMAGE") {
    return nextAttachment;
  }

  const extractedText = repaired
    ? await extractAttachmentText({
        buffer: repaired.buffer,
        kind: nextAttachment.kind as AttachmentKind,
        mimeType: nextAttachment.mimeType,
        originalName: nextAttachment.originalName
      }).catch((error) => {
        console.warn(
          `[attachments] Failed to repair text for ${nextAttachment.originalName}:`,
          error instanceof Error ? error.message : error
        );
        return null;
      })
    : null;

  if (!hasText(extractedText)) {
    return nextAttachment;
  }

  await prisma.attachment
    .update({
      where: { id: attachment.id },
      data: { extractedText }
    })
    .catch((error) => {
      console.warn(
        `[attachments] Failed to persist repaired text for ${attachment.originalName}:`,
        error instanceof Error ? error.message : error
      );
    });

  return {
    ...nextAttachment,
    extractedText
  };
}

export async function ensureAttachmentsText<T extends RepairableAttachment>(
  attachments: T[]
): Promise<T[]> {
  return Promise.all(attachments.map((attachment) => ensureAttachmentText(attachment)));
}
