import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, readJson, requireActiveUser } from "@/lib/http";
import {
  memoryHasCallNamePreference,
  memoryToView,
  prepareMemoryContentForStorage
} from "@/lib/memories";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type UpdateMemoryBody = {
  archived?: boolean;
  content?: string;
};

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const currentUser = await getUserFromRequest(request);
  const error = requireActiveUser(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  let body: UpdateMemoryBody;

  try {
    body = await readJson<UpdateMemoryBody>(request);
  } catch (readError) {
    return jsonError(readError instanceof Error ? readError.message : "更新记忆失败。", 400);
  }

  const data: {
    archivedAt?: Date | null;
    content?: string;
  } = {};
  let contentHasCallNamePreference = false;

  if (typeof body.content === "string") {
    try {
      data.content = prepareMemoryContentForStorage(body.content);
      contentHasCallNamePreference = memoryHasCallNamePreference(data.content);
    } catch (contentError) {
      return jsonError(
        contentError instanceof Error ? contentError.message : "记忆内容无效。",
        400
      );
    }
  }

  if (typeof body.archived === "boolean") {
    data.archivedAt = body.archived ? new Date() : null;
  }

  if (Object.keys(data).length === 0) {
    return jsonError("没有可更新的内容。", 400);
  }

  const { id } = await context.params;
  const existing = await prisma.userMemory.findFirst({
    where: {
      id,
      userId: currentUser.id
    }
  });

  if (!existing) {
    return jsonError("记忆不存在。", 404);
  }

  const memory = await prisma.$transaction(async (tx) => {
    if (contentHasCallNamePreference) {
      const conflictingMemories = await tx.userMemory.findMany({
        where: {
          id: { not: id },
          projectId: existing.projectId,
          userId: currentUser.id
        },
        select: {
          content: true,
          id: true
        }
      });
      const conflictingIds = conflictingMemories
        .filter((memory) => memoryHasCallNamePreference(memory.content))
        .map((memory) => memory.id);

      if (conflictingIds.length > 0) {
        await tx.userMemory.updateMany({
          where: { id: { in: conflictingIds } },
          data: { archivedAt: new Date() }
        });
      }
    }

    return tx.userMemory.update({
      where: { id },
      data,
      include: {
        project: {
          select: { name: true }
        }
      }
    });
  });

  return NextResponse.json({ memory: memoryToView(memory) });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const currentUser = await getUserFromRequest(request);
  const error = requireActiveUser(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  const { id } = await context.params;
  const deleted = await prisma.userMemory.deleteMany({
    where: {
      id,
      userId: currentUser.id
    }
  });

  if (deleted.count === 0) {
    return jsonError("记忆不存在。", 404);
  }

  return NextResponse.json({ id });
}
