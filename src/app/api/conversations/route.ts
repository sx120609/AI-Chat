import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "../../../../generated/prisma/client";
import { getUserFromRequest } from "@/lib/auth";
import { getChatModel } from "@/lib/models";
import { jsonError, readJson, requireActiveUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { getAiRuntimeSettings } from "@/lib/upstream";

export const runtime = "nodejs";

type CreateConversationBody = {
  title?: string;
  model?: string;
  mode?: "CHAT" | "IMAGE";
};

function serializeConversation(conversation: {
  _count?: { messages: number };
  createdAt: Date;
  id: string;
  mode: "CHAT" | "IMAGE";
  model: string;
  pinned?: boolean;
  title: string;
  updatedAt: Date;
}) {
  return {
    id: conversation.id,
    title: conversation.title,
    model: conversation.model,
    mode: conversation.mode,
    createdAt: conversation.createdAt.toISOString(),
    pinned: Boolean(conversation.pinned),
    updatedAt: conversation.updatedAt.toISOString(),
    _count: conversation._count
  };
}

export async function GET(request: NextRequest) {
  const user = await getUserFromRequest(request);
  const error = requireActiveUser(user);

  if (!user) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim();
  const where: Prisma.ConversationWhereInput = {
    userId: user.id,
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: "insensitive" } },
            {
              messages: {
                some: {
                  content: { contains: search, mode: "insensitive" }
                }
              }
            }
          ]
        }
      : {})
  };
  const conversations = await prisma.conversation.findMany({
    where,
    select: {
      id: true,
      title: true,
      model: true,
      mode: true,
      pinned: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: { messages: true }
      }
    },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }]
  });

  return NextResponse.json({
    conversations: conversations.map(serializeConversation)
  });
}

export async function POST(request: NextRequest) {
  const user = await getUserFromRequest(request);
  const error = requireActiveUser(user);

  if (!user) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  let body: CreateConversationBody;

  try {
    body = await readJson<CreateConversationBody>(request);
  } catch (readError) {
    return jsonError(readError instanceof Error ? readError.message : "创建会话失败。", 400);
  }

  const mode = body.mode === "IMAGE" ? "IMAGE" : "CHAT";
  const aiSettings = mode === "CHAT" ? await getAiRuntimeSettings() : null;
  const model = mode === "IMAGE" ? "image2" : getChatModel(body.model, aiSettings?.chatModels).id;
  const title = body.title?.trim() || (mode === "IMAGE" ? "New image" : "New chat");

  const conversation = await prisma.conversation.create({
    data: {
      userId: user.id,
      title,
      model,
      mode
    }
  });

  return NextResponse.json({
    conversation: serializeConversation(conversation)
  });
}
