import { attachmentKindFromMime, deleteAttachmentFiles, MAX_ATTACHMENT_BYTES, normalizeAttachmentMime, saveAttachmentBuffer } from "./attachments";
import { prisma } from "./prisma";
import { safeArtifactFilename, type WorkspaceArtifact } from "./responses-state";
import type { AiRuntimeSettings } from "./upstream";

export async function persistWorkspaceArtifact(artifact: WorkspaceArtifact, owner: {
  userId: string; conversationId: string; messageId: string; projectId: string | null;
}, upstream: AiRuntimeSettings, signal: AbortSignal): Promise<WorkspaceArtifact> {
  let buffer: Buffer;
  const filename = safeArtifactFilename(artifact.filename);
  let mimeType = normalizeAttachmentMime(filename, artifact.mimeType);
  if (artifact.content !== undefined) buffer = Buffer.from(artifact.content, "utf8");
  else if (artifact.imageData) buffer = Buffer.from(artifact.imageData, "base64");
  else {
    if (!artifact.containerId || !artifact.fileId) throw new Error("上游成果缺少文件标识。");
    const response = await fetch(`${upstream.apiBaseUrl}/containers/${encodeURIComponent(artifact.containerId)}/files/${encodeURIComponent(artifact.fileId)}/content`, {
      headers: { Authorization: `Bearer ${upstream.apiKey}`, ...(upstream.orgId ? { "OpenAI-Organization": upstream.orgId } : {}) },
      signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)])
    });
    if (!response.ok || !response.body) throw new Error("成果已生成，但从上游保存文件失败，请重试。");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.length;
        if (bytes > MAX_ATTACHMENT_BYTES) throw new Error("生成文件超过 50 MB 保存限制。");
        chunks.push(chunk.value);
      }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    buffer = Buffer.concat(chunks);
    mimeType = normalizeAttachmentMime(filename, response.headers.get("content-type") || artifact.mimeType);
  }
  if (buffer.byteLength > MAX_ATTACHMENT_BYTES) throw new Error("生成文件超过 50 MB 保存限制。");
  const storagePath = await saveAttachmentBuffer({ buffer, originalName: filename, userId: owner.userId });
  try {
    const attachment = await prisma.attachment.create({ data: {
      ...owner, kind: attachmentKindFromMime(mimeType) || "FILE", originalName: filename,
      mimeType, sizeBytes: buffer.byteLength, storagePath,
      extractedText: artifact.content?.slice(0, 80_000) || null
    } });
    return { ...artifact, filename, mimeType, attachmentId: attachment.id };
  } catch (error) {
    await deleteAttachmentFiles([{ storagePath }]);
    throw error;
  }
}
