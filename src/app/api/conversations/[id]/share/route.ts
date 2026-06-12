import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, requireActiveUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { getSiteSettings } from "@/lib/site-settings";
import { SHARE_TOKEN_BYTES } from "@/lib/conversation-share";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

async function shareUrl(request: NextRequest, token: string) {
  const siteSettings = await getSiteSettings();
  const baseUrl = siteSettings.siteUrl || request.nextUrl.origin;

  return `${baseUrl.replace(/\/+$/, "")}/share/${token}`;
}

async function createShareToken() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = randomBytes(SHARE_TOKEN_BYTES).toString("base64url");
    const existing = await prisma.conversationShare.findUnique({
      where: { token },
      select: { id: true }
    });

    if (!existing) {
      return token;
    }
  }

  throw new Error("无法生成分享链接，请稍后重试。");
}

async function requireOwnedConversation(request: NextRequest, conversationId: string) {
  const user = await getUserFromRequest(request);
  const error = requireActiveUser(user);

  if (!user) {
    return { error: jsonError("请先登录。", 401), user: null };
  }

  if (error) {
    return { error, user: null };
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      userId: user.id
    },
    select: {
      id: true,
      userId: true
    }
  });

  if (!conversation) {
    return { error: jsonError("会话不存在。", 404), user: null };
  }

  return { error: null, user };
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const guard = await requireOwnedConversation(request, id);

  if (guard.error || !guard.user) {
    return guard.error;
  }

  const share = await prisma.conversationShare.findUnique({
    where: { conversationId: id },
    select: {
      createdAt: true,
      token: true,
      updatedAt: true
    }
  });

  return NextResponse.json({
    share: share
      ? {
          token: share.token,
          url: await shareUrl(request, share.token),
          createdAt: share.createdAt.toISOString(),
          updatedAt: share.updatedAt.toISOString()
        }
      : null
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const guard = await requireOwnedConversation(request, id);

  if (guard.error || !guard.user) {
    return guard.error;
  }

  let share = await prisma.conversationShare.findUnique({
    where: { conversationId: id },
    select: {
      createdAt: true,
      token: true,
      updatedAt: true
    }
  });

  if (!share) {
    const token = await createShareToken();

    share = await prisma.conversationShare.create({
      data: {
        conversationId: id,
        token,
        userId: guard.user.id
      },
      select: {
        createdAt: true,
        token: true,
        updatedAt: true
      }
    });
  }

  return NextResponse.json({
    share: {
      token: share.token,
      url: await shareUrl(request, share.token),
      createdAt: share.createdAt.toISOString(),
      updatedAt: share.updatedAt.toISOString()
    }
  });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const guard = await requireOwnedConversation(request, id);

  if (guard.error || !guard.user) {
    return guard.error;
  }

  await prisma.conversationShare.deleteMany({
    where: {
      conversationId: id,
      userId: guard.user.id
    }
  });

  return NextResponse.json({ ok: true });
}
