import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, requireActiveUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function numberParam(value: string | null, fallback: number) {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  const currentUser = await getUserFromRequest(request);
  const error = requireActiveUser(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  const limit = Math.min(200, Math.max(1, numberParam(request.nextUrl.searchParams.get("limit"), 100)));
  const offset = Math.max(0, numberParam(request.nextUrl.searchParams.get("offset"), 0));
  const where = { userId: currentUser.id };
  const [files, total] = await Promise.all([
    prisma.attachment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit,
      select: {
        id: true,
        projectId: true,
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
        },
        project: {
          select: {
            name: true
          }
        }
      }
    }),
    prisma.attachment.count({ where })
  ]);

  return NextResponse.json({
    hasMore: offset + files.length < total,
    limit,
    offset,
    total,
    files: files.map((file) => ({
      id: file.id,
      projectId: file.projectId,
      projectName: file.project?.name ?? null,
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
