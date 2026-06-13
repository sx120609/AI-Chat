import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, readJson, requireActiveUser } from "@/lib/http";
import { createUserMemory, listUserMemories, memoryToView } from "@/lib/memories";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type CreateMemoryBody = {
  content?: string;
  projectId?: string | null;
};

export async function GET(request: NextRequest) {
  const currentUser = await getUserFromRequest(request);
  const error = requireActiveUser(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  const includeArchived = request.nextUrl.searchParams.get("includeArchived") === "1";

  return NextResponse.json({
    memories: await listUserMemories(currentUser.id, { includeArchived, includeProjects: true })
  });
}

export async function POST(request: NextRequest) {
  const currentUser = await getUserFromRequest(request);
  const error = requireActiveUser(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  let body: CreateMemoryBody;

  try {
    body = await readJson<CreateMemoryBody>(request);
  } catch (readError) {
    return jsonError(readError instanceof Error ? readError.message : "新增记忆失败。", 400);
  }

  try {
    const projectId =
      typeof body.projectId === "string" && body.projectId.trim() ? body.projectId.trim() : null;

    if (projectId) {
      const project = await prisma.userProject.findFirst({
        where: { id: projectId, userId: currentUser.id },
        select: { id: true }
      });

      if (!project) {
        return jsonError("项目不存在。", 404);
      }
    }

    const memory = await createUserMemory({
      content: body.content || "",
      projectId,
      source: "manual",
      userId: currentUser.id
    });

    return NextResponse.json({ memory: memoryToView(memory) });
  } catch (createError) {
    return jsonError(createError instanceof Error ? createError.message : "新增记忆失败。", 400);
  }
}

export async function DELETE(request: NextRequest) {
  const currentUser = await getUserFromRequest(request);
  const error = requireActiveUser(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  const deleted = await prisma.userMemory.deleteMany({
    where: { userId: currentUser.id }
  });

  return NextResponse.json({ deleted: deleted.count });
}
