import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, requireActiveUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

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
  const deleted = await prisma.conversationShare.deleteMany({
    where: {
      id,
      userId: currentUser.id
    }
  });

  if (deleted.count === 0) {
    return jsonError("共享链接不存在。", 404);
  }

  return NextResponse.json({ id });
}
