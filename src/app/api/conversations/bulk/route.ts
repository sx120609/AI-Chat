import { NextRequest, NextResponse } from "next/server";
import { deleteAttachmentFiles } from "@/lib/attachments";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, readJson, requireActiveUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BulkDeleteBody = {
  ids?: string[];
};

function uniqueIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.filter((item): item is string => typeof item === "string"))].slice(
    0,
    100
  );
}

export async function DELETE(request: NextRequest) {
  const user = await getUserFromRequest(request);
  const error = requireActiveUser(user);

  if (!user) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  let body: BulkDeleteBody;

  try {
    body = await readJson<BulkDeleteBody>(request);
  } catch (readError) {
    return jsonError(readError instanceof Error ? readError.message : "批量删除失败。", 400);
  }

  const ids = uniqueIds(body.ids);

  if (ids.length === 0) {
    return jsonError("请选择要删除的会话。", 400);
  }

  const conversations = await prisma.conversation.findMany({
    where: {
      id: { in: ids },
      userId: user.id
    },
    select: {
      id: true,
      attachments: true
    }
  });

  if (conversations.length === 0) {
    return jsonError("没有可删除的会话。", 404);
  }

  await prisma.conversation.deleteMany({
    where: {
      id: { in: conversations.map((conversation) => conversation.id) },
      userId: user.id
    }
  });

  await deleteAttachmentFiles(conversations.flatMap((conversation) => conversation.attachments));

  return NextResponse.json({ deleted: conversations.length });
}
