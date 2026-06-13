import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, requireActiveUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const currentUser = await getUserFromRequest(request);
  const error = requireActiveUser(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  const files = await prisma.attachment.findMany({
    where: { userId: currentUser.id },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      conversationId: true,
      messageId: true,
      kind: true,
      originalName: true,
      mimeType: true,
      sizeBytes: true,
      temporary: true,
      createdAt: true,
      conversation: {
        select: {
          title: true,
          archivedAt: true
        }
      }
    }
  });

  return NextResponse.json({
    files: files.map((file) => ({
      id: file.id,
      conversationId: file.conversationId,
      messageId: file.messageId,
      kind: file.kind,
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      temporary: file.temporary,
      conversationTitle: file.conversation?.title ?? null,
      conversationArchivedAt: file.conversation?.archivedAt?.toISOString() ?? null,
      createdAt: file.createdAt.toISOString()
    }))
  });
}
