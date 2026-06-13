import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, readJson, requireActiveUser } from "@/lib/http";
import { memoryToView } from "@/lib/memories";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const MAX_MEMORY_CONTENT_CHARS = 280;

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

  if (typeof body.content === "string") {
    const content = body.content.trim().replace(/\s+/g, " ").slice(0, MAX_MEMORY_CONTENT_CHARS);

    if (content.length < 2) {
      return jsonError("记忆内容太短。", 400);
    }

    data.content = content;
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

  const memory = await prisma.userMemory.update({
    where: { id },
    data
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
