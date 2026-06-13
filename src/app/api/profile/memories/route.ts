import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, readJson, requireActiveUser } from "@/lib/http";
import { createUserMemory, listUserMemories, memoryToView } from "@/lib/memories";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type CreateMemoryBody = {
  content?: string;
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
    memories: await listUserMemories(currentUser.id, { includeArchived })
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
    const memory = await createUserMemory({
      content: body.content || "",
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
