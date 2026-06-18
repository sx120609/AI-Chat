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

  const [
    apiKeys,
    attachments,
    conversations,
    memories,
    projects,
    sharedLinks,
    user,
    usageRecords
  ] = await Promise.all([
    prisma.userApiKey.findMany({
      where: { userId: currentUser.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        active: true,
        lastUsedAt: true,
        createdAt: true,
        updatedAt: true
      }
    }),
    prisma.attachment.findMany({
      where: { userId: currentUser.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        projectId: true,
        conversationId: true,
        messageId: true,
        kind: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        temporary: true,
        createdAt: true
      }
    }),
    prisma.conversation.findMany({
      where: { userId: currentUser.id },
      orderBy: { updatedAt: "desc" },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            role: true,
            content: true,
            reasoningContent: true,
            imageUrl: true,
            webSourcesJson: true,
            generationStatus: true,
            model: true,
            mode: true,
            promptTokens: true,
            completionTokens: true,
            totalTokens: true,
            estimatedCostCents: true,
            createdAt: true
          }
        },
        share: {
          select: {
            id: true,
            token: true,
            createdAt: true,
            updatedAt: true
          }
        }
      }
    }),
    prisma.userMemory.findMany({
      where: { userId: currentUser.id },
      orderBy: { updatedAt: "desc" }
    }),
    prisma.userProject.findMany({
      where: { userId: currentUser.id },
      orderBy: { updatedAt: "desc" }
    }),
    prisma.conversationShare.findMany({
      where: { userId: currentUser.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        token: true,
        conversationId: true,
        createdAt: true,
        updatedAt: true
      }
    }),
    prisma.user.findUnique({
      where: { id: currentUser.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        userGroup: true,
        active: true,
        emailVerified: true,
        aiStylePrompt: true,
        aiPointsBalanceCents: true,
        monthlyCostLimitCents: true,
        quotaNextResetAt: true,
        quotaResetAt: true,
        createdAt: true,
        updatedAt: true
      }
    }),
    prisma.usageRecord.findMany({
      where: { userId: currentUser.id },
      orderBy: { createdAt: "desc" }
    })
  ]);

  if (!user) {
    return jsonError("用户不存在。", 404);
  }

  return NextResponse.json({
    exportedAt: new Date().toISOString(),
    version: 1,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      userGroup: user.userGroup,
      active: user.active,
      emailVerified: user.emailVerified,
      aiStylePrompt: user.aiStylePrompt,
      aiPointsBalanceCents: user.aiPointsBalanceCents,
      monthlyCostLimitCents: user.monthlyCostLimitCents,
      quotaNextResetAt: user.quotaNextResetAt.toISOString(),
      quotaResetAt: user.quotaResetAt.toISOString(),
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString()
    },
    apiKeys,
    attachments,
    conversations,
    memories,
    projects,
    sharedLinks,
    usageRecords
  });
}
