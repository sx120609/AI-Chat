import { readAttachmentBuffer } from "@/lib/attachments";
import { NextRequest } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, requireActiveUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { parseResponseState, safeArtifactFilename } from "@/lib/responses-state";
import { getChatModel } from "@/lib/models";
import { getAiRuntimeSettings, resolveUpstreamSettingsForModel, responseScope } from "@/lib/upstream";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string; artifactId: string }> }) {
  const user = await getUserFromRequest(request);
  const error = requireActiveUser(user);
  if (error) return error;
  if (!user) return jsonError("请先登录。", 401);
  const { id, artifactId } = await context.params;
  const message = await prisma.message.findFirst({ where: { id, conversation: { userId: user.id } }, select: { model: true, responseStateJson: true } });
  if (!message) return jsonError("成果不存在。", 404);
  const state = parseResponseState(message.responseStateJson);
  const artifact = state.artifacts.find(item => item.id === artifactId);
  if (!artifact) return jsonError("成果不存在。", 404);
  const headers = {
    "content-type": artifact.mimeType.startsWith("text/") ? `${artifact.mimeType}; charset=utf-8` : artifact.mimeType,
    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeArtifactFilename(artifact.filename))}`,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox"
  };
  if (artifact.attachmentId) {
    const attachment = await prisma.attachment.findFirst({ where: { id: artifact.attachmentId, userId: user.id, messageId: id } });
    if (!attachment) return jsonError("成果文件已被删除。", 410);
    const buffer = await readAttachmentBuffer(attachment).catch(() => null);
    if (!buffer) return jsonError("成果文件暂时不可用。", 410);
    return new Response(buffer, { headers });
  }
  if (artifact.content !== undefined) return new Response(artifact.content, { headers });
  if (artifact.imageData) return new Response(Buffer.from(artifact.imageData, "base64"), { headers });
  if (!artifact.fileId || !artifact.containerId) return jsonError("成果文件不可用。", 410);
  const settings = await getAiRuntimeSettings();
  const model = getChatModel(message.model || undefined, settings.chatModels, { includeDisabled: true });
  if (state.scope !== responseScope(settings, model)) return jsonError("上游配置已变更，无法访问此成果。", 409);
  const upstream = resolveUpstreamSettingsForModel(settings, model);
  const file = await fetch(`${upstream.apiBaseUrl}/containers/${encodeURIComponent(artifact.containerId)}/files/${encodeURIComponent(artifact.fileId)}/content`, {
    headers: { Authorization: `Bearer ${upstream.apiKey}`, ...(upstream.orgId ? { "OpenAI-Organization": upstream.orgId } : {}) },
    signal: AbortSignal.timeout(60_000)
  });
  if (!file.ok) return jsonError("上游成果已过期或暂时无法下载，请重新生成。", file.status === 404 ? 410 : 502);
  return new Response(file.body, { headers: { ...headers, "content-type": file.headers.get("content-type") || "application/octet-stream" } });
}
