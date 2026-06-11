import { NextRequest } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, requireActiveUser } from "@/lib/http";
import { readAttachmentBuffer } from "@/lib/attachments";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function contentDisposition(fileName: string) {
  const safeName = fileName.replace(/[^\w.\-\u4e00-\u9fa5 ]+/g, "_");

  return `inline; filename="${encodeURIComponent(safeName)}"`;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const user = await getUserFromRequest(request);
  const authError = requireActiveUser(user);

  if (!user) {
    return jsonError("请先登录。", 401);
  }

  if (authError) {
    return authError;
  }

  const { id } = await context.params;
  const attachment = await prisma.attachment.findFirst({
    where: {
      id,
      userId: user.id
    }
  });

  if (!attachment) {
    return jsonError("附件不存在。", 404);
  }

  const buffer = await readAttachmentBuffer(attachment).catch(() => null);

  if (!buffer) {
    return jsonError("附件文件丢失。", 404);
  }

  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-disposition": contentDisposition(attachment.originalName),
      "content-length": String(buffer.byteLength),
      "content-type": attachment.mimeType
    }
  });
}
