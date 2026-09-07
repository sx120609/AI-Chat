import { prisma } from "./prisma";
import { MESSAGE_ORDER_ASC, messagesBefore } from "./message-order";
import { readAttachmentBuffer, saveAttachmentBuffer, deleteAttachmentFiles } from "./attachments";
import { parseResponseState } from "./responses-state";

export async function branchAtUserMessage(userId: string, messageId: string, editedContent?: string) {
  const source = await prisma.message.findFirst({ where: { id: messageId, role: "USER", conversation: { userId } }, include: { conversation: true } });
  if (!source) throw new Error("要分支的消息不存在。");
  const history = await prisma.message.findMany({ where: { conversationId: source.conversationId, OR: [{ id: source.id }, messagesBefore(source)] }, include: { attachments: true }, orderBy: MESSAGE_ORDER_ASC });
  const copiedFiles: Array<{ storagePath: string }> = [];
  try {
    return await prisma.$transaction(async tx => {
      const conversation = await tx.conversation.create({ data: { userId, projectId: source.conversation.projectId, model: source.conversation.model, mode: source.conversation.mode, title: `${source.conversation.title.slice(0, 65)} · 分支` } });
      let lastMessageId = "";
      let lastCreatedAt = 0;
      for (const message of history) {
        const { id: oldId, attachments, ...data } = message;
        lastCreatedAt = Math.max(data.createdAt.getTime(), lastCreatedAt + 1);
        const copy = await tx.message.create({ data: {
          ...data, conversationId: conversation.id, createdAt: new Date(lastCreatedAt),
          ...(oldId === messageId && editedContent !== undefined ? { content: editedContent } : {}),
          generationStatus: data.generationStatus === "running" ? "stopped" : data.generationStatus,
          runHeartbeatAt: null, stopRequested: false
        } });
        const attachmentIds = new Map<string, string>();
        for (const attachment of attachments) {
          const storagePath = await saveAttachmentBuffer({ buffer: await readAttachmentBuffer(attachment), originalName: attachment.originalName, userId });
          copiedFiles.push({ storagePath });
          const { id: attachmentId, ...attachmentData } = attachment;
          const cloned = await tx.attachment.create({ data: { ...attachmentData, storagePath, conversationId: conversation.id, messageId: copy.id } });
          attachmentIds.set(attachmentId, cloned.id);
        }
        const state = parseResponseState(message.responseStateJson);
        if (state.artifacts.length) {
          state.artifacts = state.artifacts.map(artifact => ({ ...artifact, attachmentId: artifact.attachmentId ? attachmentIds.get(artifact.attachmentId) : undefined }));
          await tx.message.update({ where: { id: copy.id }, data: { responseStateJson: JSON.stringify(state) } });
        }
        lastMessageId = copy.id;
      }
      return tx.message.findUniqueOrThrow({ where: { id: lastMessageId }, include: { attachments: true, conversation: { include: { project: true, _count: { select: { messages: true } } } } } });
    }, { timeout: 60_000 });
  } catch (error) {
    await deleteAttachmentFiles(copiedFiles);
    throw error;
  }
}
