import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { coerceInt, jsonError, requireAdmin } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isPersonalApiUsage(usageSource: string) {
  return usageSource.startsWith("user_api:");
}

function personalApiPrefix(usageSource: string) {
  const segments = usageSource.split(":");

  return segments.length >= 3 && segments[0] === "user_api" && segments[1] ? segments[1] : null;
}

function usageSourceLabel(record: { conversationId: string | null; mode: string; usageSource: string }) {
  const source = record.usageSource.split(":").at(-1);
  const metering = source === "upstream" ? "上游 usage" : "估算";

  if (isPersonalApiUsage(record.usageSource)) {
    return `个人 API · ${metering}`;
  }

  if (record.mode === "IMAGE") {
    return `图片 · ${metering}`;
  }

  return record.conversationId ? `聊天 · ${metering}` : `任务 · ${metering}`;
}

function usageSurface(record: { conversationId: string | null; mode: string; usageSource: string }) {
  if (record.mode === "IMAGE") {
    return "图片";
  }

  if (isPersonalApiUsage(record.usageSource)) {
    return "个人 API";
  }

  return record.conversationId ? "聊天" : "任务";
}

export async function GET(request: NextRequest) {
  const currentUser = await getUserFromRequest(request);
  const error = requireAdmin(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  const limit = Math.min(200, coerceInt(request.nextUrl.searchParams.get("limit"), 100, 1));
  const records = await prisma.usageRecord.findMany({
    include: {
      conversation: {
        select: {
          id: true,
          title: true
        }
      },
      user: {
        select: {
          email: true,
          id: true,
          name: true
        }
      }
    },
    orderBy: { createdAt: "desc" },
    take: limit
  });
  const apiKeyPrefixes = Array.from(
    new Set(records.map((record) => personalApiPrefix(record.usageSource)).filter(Boolean))
  ) as string[];
  const apiKeys =
    apiKeyPrefixes.length > 0
      ? await prisma.userApiKey.findMany({
          select: {
            keyPrefix: true,
            name: true,
            userId: true
          },
          where: {
            keyPrefix: {
              in: apiKeyPrefixes
            }
          }
        })
      : [];
  const apiKeyNames = new Map(apiKeys.map((key) => [`${key.userId}:${key.keyPrefix}`, key.name]));

  const usageRecords = records.map((record) => {
    const apiKeyPrefix = personalApiPrefix(record.usageSource);
    const apiKeyName = apiKeyPrefix ? apiKeyNames.get(`${record.userId}:${apiKeyPrefix}`) : null;

    return {
      id: record.id,
      apiKeyLabel: apiKeyPrefix
        ? apiKeyName
          ? `${apiKeyName}（${apiKeyPrefix}...）`
          : `API Key ${apiKeyPrefix}...`
        : null,
      cachedPromptTokens: record.cachedPromptTokens,
      completionTokens: record.completionTokens,
      conversationId: record.conversationId,
      conversationTitle: record.conversation?.title ?? null,
      createdAt: record.createdAt.toISOString(),
      estimatedCostCents: record.estimatedCostCents,
      messageId: record.messageId,
      mode: record.mode,
      model: record.model,
      promptTokens: record.promptTokens,
      reasoningTokens: record.reasoningTokens,
      sourceLabel: usageSourceLabel(record),
      surface: usageSurface(record),
      totalTokens: record.totalTokens,
      usageSource: record.usageSource,
      userEmail: record.user.email,
      userId: record.user.id,
      userName: record.user.name
    };
  });

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    limit,
    records: usageRecords,
    summary: {
      apiCalls: usageRecords.filter((record) => record.surface === "个人 API").length,
      cachedPromptTokens: usageRecords.reduce((total, record) => total + record.cachedPromptTokens, 0),
      chatCalls: usageRecords.filter((record) => record.surface === "聊天").length,
      completionTokens: usageRecords.reduce((total, record) => total + record.completionTokens, 0),
      costCents: usageRecords.reduce((total, record) => total + record.estimatedCostCents, 0),
      imageCalls: usageRecords.filter((record) => record.surface === "图片").length,
      promptTokens: usageRecords.reduce((total, record) => total + record.promptTokens, 0),
      reasoningTokens: usageRecords.reduce((total, record) => total + record.reasoningTokens, 0),
      records: usageRecords.length,
      totalTokens: usageRecords.reduce((total, record) => total + record.totalTokens, 0)
    }
  });
}
