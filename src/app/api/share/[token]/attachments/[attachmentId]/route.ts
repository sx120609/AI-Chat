import { NextRequest } from "next/server";
import { getSharedAttachment } from "@/lib/conversation-share";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    attachmentId: string;
    token: string;
  }>;
};

function contentDisposition(fileName: string) {
  const safeName = fileName.replace(/[^\w.\-\u4e00-\u9fa5 ]+/g, "_");

  return `inline; filename="${encodeURIComponent(safeName)}"`;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { attachmentId, token } = await context.params;
  const sharedAttachment = await getSharedAttachment(token, attachmentId);

  if (!sharedAttachment) {
    return jsonError("附件不存在或分享已失效。", 404);
  }

  return new Response(new Uint8Array(sharedAttachment.buffer), {
    headers: {
      "cache-control": "public, max-age=3600",
      "content-disposition": contentDisposition(sharedAttachment.attachment.originalName),
      "content-length": String(sharedAttachment.buffer.byteLength),
      "content-type": sharedAttachment.attachment.mimeType
    }
  });
}
