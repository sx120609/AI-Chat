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

export async function ensureAttachmentMetadata<T extends RepairableAttachment>(
  attachment: T
): Promise<T> {
  const repaired = await repairAttachmentType(attachment).catch((error) => {
    console.warn(
      `[attachments] Failed to repair type for ${attachment.originalName}:`,
      error instanceof Error ? error.message : error
    );
    return null;
  });

  return repaired?.attachment ?? attachment;
}

export async function ensureAttachmentText<T extends RepairableAttachment>(
  attachment: T
): Promise<T> {
  const nextAttachment = await ensureAttachmentMetadata(attachment);

  if (hasText(nextAttachment.extractedText) || nextAttachment.kind === "IMAGE") {
    return nextAttachment;
  }

  const buffer = await readAttachmentBuffer(nextAttachment).catch((error) => {
    console.warn(
      `[attachments] Failed to read ${nextAttachment.originalName} for fallback text:`,
      error instanceof Error ? error.message : error
    );
    return null;
  });

  if (!buffer) {
    return nextAttachment;
  }

  const extractedText = await extractAttachmentText({
    buffer,
    kind: nextAttachment.kind as AttachmentKind,
    mimeType: nextAttachment.mimeType,
    originalName: nextAttachment.originalName
  }).catch((error) => {
    console.warn(
      `[attachments] Failed to repair text for ${nextAttachment.originalName}:`,
      error instanceof Error ? error.message : error
    );
    return null;
  });

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

export async function ensureAttachmentsMetadata<T extends RepairableAttachment>(
  attachments: T[]
): Promise<T[]> {
  return Promise.all(attachments.map((attachment) => ensureAttachmentMetadata(attachment)));
}
