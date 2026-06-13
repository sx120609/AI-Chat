import { NextRequest, NextResponse } from "next/server";
import { deleteAttachmentFiles } from "@/lib/attachments";
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
  const attachment = await prisma.attachment.findFirst({
    where: {
      id,
      userId: currentUser.id
    },
    select: {
      id: true,
      storagePath: true
    }
  });

  if (!attachment) {
    return jsonError("文件不存在。", 404);
  }

  await prisma.attachment.delete({
    where: { id: attachment.id }
  });
  await deleteAttachmentFiles([attachment]);

  return NextResponse.json({ id });
}
