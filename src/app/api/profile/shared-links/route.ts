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

  const links = await prisma.conversationShare.findMany({
    where: { userId: currentUser.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      token: true,
      conversationId: true,
      createdAt: true,
      updatedAt: true,
      conversation: {
        select: {
          title: true,
          model: true,
          mode: true,
          updatedAt: true
        }
      }
    }
  });

  return NextResponse.json({
    links: links.map((link) => ({
      id: link.id,
      token: link.token,
      conversationId: link.conversationId,
      title: link.conversation.title,
      model: link.conversation.model,
      mode: link.conversation.mode,
      conversationUpdatedAt: link.conversation.updatedAt.toISOString(),
      createdAt: link.createdAt.toISOString(),
      updatedAt: link.updatedAt.toISOString()
    }))
  });
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

  const deleted = await prisma.conversationShare.deleteMany({
    where: { userId: currentUser.id }
  });

  return NextResponse.json({ deleted: deleted.count });
}
