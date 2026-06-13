import { NextRequest, NextResponse } from "next/server";
import {
  attachmentToView,
  saveAttachmentBuffer,
  validateAttachment
} from "@/lib/attachments";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, requireActiveUser } from "@/lib/http";
import { parsePersonalizationSettings } from "@/lib/personalization";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await getUserFromRequest(request);
  const authError = requireActiveUser(user);

  if (!user) {
    return jsonError("请先登录。", 401);
  }

  if (authError) {
    return authError;
  }

  const personalizationSettings = parsePersonalizationSettings(user.aiStylePrompt);

  if (personalizationSettings.toolPreferences.securityMode) {
    return jsonError("隐私 / 安全模式已关闭文件上传。", 403);
  }

  if (!personalizationSettings.toolPreferences.fileAnalysisEnabled) {
    return jsonError("文件分析已在个人中心关闭。", 403);
  }

  const formData = await request.formData().catch(() => null);

  if (!formData) {
    return jsonError("上传请求格式无效。", 400);
  }

  const files = formData
    .getAll("files")
    .filter((item): item is File => item instanceof File && item.size > 0);
  const temporary = formData.get("temporary") === "1";
  const projectIdValue = formData.get("projectId");
  const projectId =
    typeof projectIdValue === "string" && projectIdValue.trim() ? projectIdValue.trim() : null;

  if (files.length === 0) {
    return jsonError("请选择要上传的文件。", 400);
  }

  if (files.length > 8) {
    return jsonError("一次最多上传 8 个附件。", 400);
  }

  if (projectId) {
    const project = await prisma.userProject.findFirst({
      where: { id: projectId, userId: user.id },
      select: { id: true }
    });

    if (!project) {
      return jsonError("项目不存在。", 404);
    }
  }

  const attachments = [];

  try {
    for (const file of files) {
      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        const { kind, mimeType } = validateAttachment(
          file.name,
          file.type,
          buffer.byteLength,
          buffer
        );
        const storagePath = await saveAttachmentBuffer({
          buffer,
          originalName: file.name,
          userId: user.id
        });

        const attachment = await prisma.attachment.create({
          data: {
            userId: user.id,
            projectId,
            kind,
            originalName: file.name,
            mimeType,
            sizeBytes: buffer.byteLength,
            storagePath,
            temporary,
            extractedText: null
          }
        });

        attachments.push(attachmentToView(attachment));
      } catch (fileError) {
        throw new Error(
          `${file.name}: ${fileError instanceof Error ? fileError.message : "附件处理失败。"}`
        );
      }
    }
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "附件上传失败。", 400);
  }

  return NextResponse.json({ attachments });
}
