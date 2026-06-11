import { extractStoredAttachmentText } from "@/lib/attachments";
import { prisma } from "@/lib/prisma";

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

export async function ensureAttachmentText<T extends RepairableAttachment>(
  attachment: T
): Promise<T> {
  if (attachment.kind === "IMAGE" || hasText(attachment.extractedText)) {
    return attachment;
  }

  const extractedText = await extractStoredAttachmentText(attachment).catch((error) => {
    console.warn(
      `[attachments] Failed to repair text for ${attachment.originalName}:`,
      error instanceof Error ? error.message : error
    );
    return null;
  });

  if (!hasText(extractedText)) {
    return attachment;
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
    ...attachment,
    extractedText
  };
}

export async function ensureAttachmentsText<T extends RepairableAttachment>(
  attachments: T[]
): Promise<T[]> {
  return Promise.all(attachments.map((attachment) => ensureAttachmentText(attachment)));
}
