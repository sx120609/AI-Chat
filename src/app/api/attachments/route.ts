import { NextRequest, NextResponse } from "next/server";
import {
  attachmentToView,
  extractAttachmentText,
  saveAttachmentBuffer,
  validateAttachment
} from "@/lib/attachments";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, requireActiveUser } from "@/lib/http";
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

  const formData = await request.formData().catch(() => null);

  if (!formData) {
    return jsonError("上传请求格式无效。", 400);
  }

  const files = formData
    .getAll("files")
    .filter((item): item is File => item instanceof File && item.size > 0);

  if (files.length === 0) {
    return jsonError("请选择要上传的文件。", 400);
  }

  if (files.length > 8) {
    return jsonError("一次最多上传 8 个附件。", 400);
  }

  const attachments = [];

  try {
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const { kind, mimeType } = validateAttachment(file.name, file.type, buffer.byteLength);
      const storagePath = await saveAttachmentBuffer({
        buffer,
        originalName: file.name,
        userId: user.id
      });
      const extractedText = await extractAttachmentText({
        buffer,
        kind,
        mimeType,
        originalName: file.name
      });

      const attachment = await prisma.attachment.create({
        data: {
          userId: user.id,
          kind,
          originalName: file.name,
          mimeType,
          sizeBytes: buffer.byteLength,
          storagePath,
          extractedText
        }
      });

      attachments.push(attachmentToView(attachment));
    }
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "附件上传失败。", 400);
  }

  return NextResponse.json({ attachments });
}
