import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, requireActiveUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getUserFromRequest(request);
  const error = requireActiveUser(user);
  if (error) return error;
  if (!user) return jsonError("请先登录。", 401);
  const { id } = await context.params;
  const message = await prisma.message.findFirst({ where: { id, conversation: { userId: user.id } }, select: { id: true, generationStatus: true } });
  if (!message) return jsonError("任务不存在。", 404);
  if (message.generationStatus === "running") await prisma.message.update({ where: { id }, data: { stopRequested: true } });
  return NextResponse.json({ accepted: true });
}
