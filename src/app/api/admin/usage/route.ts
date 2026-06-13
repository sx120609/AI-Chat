import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "../../../../../generated/prisma/client";
import { getUserFromRequest } from "@/lib/auth";
import { coerceInt, jsonError, requireAdmin } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PAGE_LIMIT = 1000;
const MAX_CSV_LIMIT = 5000;

function isPersonalApiUsage(usageSource: string) {
  return usageSource.startsWith("user_api:");
}

function personalApiPrefix(usageSource: string) {
  const segments = usageSource.split(":");

  return segments.length >= 3 && segments[0] === "user_api" && segments[1] ? segments[1] : null;
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

function usageSourceLabel(record: { conversationId: string | null; mode: string; usageSource: string }) {
  const source = record.usageSource.split(":").at(-1);
  const metering = source === "upstream" ? "上游 usage" : "估算";

  return `${usageSurface(record)} · ${metering}`;
}

function fallbackEndpoint(record: { conversationId: string | null; mode: string; usageSource: string }) {
  if (isPersonalApiUsage(record.usageSource)) {
    return "个人 API";
  }

  if (record.mode === "IMAGE") {
    return "图片";
  }

  return record.conversationId ? "/api/chat" : "task";
}

function fallbackRequestKind(record: { conversationId: string | null; mode: string; usageSource: string }) {
  if (record.mode === "IMAGE" || !record.conversationId) {
    return "sync";
  }

  return record.conversationId ? "stream" : "";
}

function parseDays(value: string | null) {
  if (!value || value === "7") {
    return 7;
  }

  if (value === "all") {
    return null;
  }

  const parsed = coerceInt(value, 7, 1);

  return Math.min(365, parsed);
}

function buildUsageWhere(searchParams: URLSearchParams): Prisma.UsageRecordWhereInput {
  const and: Prisma.UsageRecordWhereInput[] = [];
  const apiKey = searchParams.get("apiKey") || "";
  const days = parseDays(searchParams.get("days"));
  const model = searchParams.get("model") || "";
  const query = (searchParams.get("q") || "").trim();
  const surface = searchParams.get("surface") || "";
  const userId = searchParams.get("userId") || "";

  if (days) {
    and.push({
      createdAt: {
        gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      }
    });
  }

  if (apiKey && apiKey !== "all") {
    and.push({ usageSource: { startsWith: `user_api:${apiKey}:` } });
  }

  if (model && model !== "all") {
    and.push({ model });
  }

  if (userId && userId !== "all") {
    and.push({ userId });
  }

  if (surface === "api") {
    and.push({ usageSource: { startsWith: "user_api:" } });
  } else if (surface === "chat") {
    and.push({
      conversationId: { not: null },
      mode: "CHAT",
      NOT: { usageSource: { startsWith: "user_api:" } }
    });
  } else if (surface === "image") {
    and.push({ mode: "IMAGE" });
  } else if (surface === "task") {
    and.push({
      conversationId: null,
      mode: "CHAT",
      NOT: { usageSource: { startsWith: "user_api:" } }
    });
  }

  if (query) {
    and.push({
      OR: [
        { endpoint: { contains: query } },
        { model: { contains: query } },
        { usageSource: { contains: query } },
        { userAgent: { contains: query } },
        { user: { is: { email: { contains: query } } } },
        { user: { is: { name: { contains: query } } } },
        { conversation: { is: { title: { contains: query } } } }
      ]
    });
  }

  return and.length > 0 ? { AND: and } : {};
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");

  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function formatMs(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function csvResponse(records: ReturnType<typeof serializeUsageRecord>[]) {
  const header = [
    "id",
    "createdAt",
    "user",
    "email",
    "surface",
    "apiKey",
    "model",
    "reasoningEffort",
    "endpoint",
    "requestKind",
    "billingMode",
    "promptTokens",
    "completionTokens",
    "cachedPromptTokens",
    "reasoningTokens",
    "totalTokens",
    "estimatedCostCents",
    "firstTokenLatencyMs",
    "durationMs",
    "conversation",
    "messageId",
    "userAgent",
    "usageSource"
  ];
  const rows = records.map((record) => [
    record.id,
    record.createdAt,
    record.userName,
    record.userEmail,
    record.surface,
    record.apiKeyLabel ?? "",
    record.model,
    record.reasoningEffort,
    record.endpoint,
    record.requestKind,
    record.billingMode,
    record.promptTokens,
    record.completionTokens,
    record.cachedPromptTokens,
    record.reasoningTokens,
    record.totalTokens,
    record.estimatedCostCents,
    formatMs(record.firstTokenLatencyMs),
    formatMs(record.durationMs),
    record.conversationTitle ?? record.conversationId ?? "",
    record.messageId ?? "",
    record.userAgent,
    record.usageSource
  ]);

  return new Response(`\ufeff${[header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n")}`, {
    headers: {
      "content-disposition": `attachment; filename="admin-usage-${new Date().toISOString().slice(0, 10)}.csv"`,
      "content-type": "text/csv; charset=utf-8"
    }
  });
}

function serializeUsageRecord(
  record: Prisma.UsageRecordGetPayload<{
    include: {
      conversation: { select: { id: true; title: true } };
      user: { select: { email: true; id: true; name: true } };
    };
  }>,
  apiKeyNames: Map<string, string>
) {
  const apiKeyPrefix = personalApiPrefix(record.usageSource);
  const apiKeyName = apiKeyPrefix ? apiKeyNames.get(`${record.userId}:${apiKeyPrefix}`) : null;
  const apiKeyLabel = apiKeyPrefix
    ? apiKeyName
      ? `${apiKeyName}（${apiKeyPrefix}...）`
      : `API Key ${apiKeyPrefix}...`
    : null;

  return {
    id: record.id,
    apiKeyLabel,
    apiKeyPrefix,
    billingMode: record.billingMode || "按量",
    cachedPromptTokens: record.cachedPromptTokens,
    completionTokens: record.completionTokens,
    conversationId: record.conversationId,
    conversationTitle: record.conversation?.title ?? null,
    createdAt: record.createdAt.toISOString(),
    durationMs: record.durationMs,
    endpoint: record.endpoint || fallbackEndpoint(record),
    estimatedCostCents: record.estimatedCostCents,
    firstTokenLatencyMs: record.firstTokenLatencyMs,
    messageId: record.messageId,
    mode: record.mode,
    model: record.model,
    promptTokens: record.promptTokens,
    reasoningEffort: record.reasoningEffort,
    reasoningTokens: record.reasoningTokens,
    requestKind: record.requestKind || fallbackRequestKind(record),
    sourceLabel: usageSourceLabel(record),
    surface: usageSurface(record),
    totalTokens: record.totalTokens,
    usageSource: record.usageSource,
    userAgent: record.userAgent,
    userEmail: record.user.email,
    userId: record.user.id,
    userName: record.user.name
  };
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

  const where = buildUsageWhere(request.nextUrl.searchParams);
  const csv = request.nextUrl.searchParams.get("format") === "csv";
  const limit = Math.min(
    csv ? MAX_CSV_LIMIT : MAX_PAGE_LIMIT,
    coerceInt(request.nextUrl.searchParams.get("limit"), csv ? MAX_CSV_LIMIT : 500, 1)
  );
  const [records, totalCount, totals, apiCalls, chatCalls, imageCalls, taskCalls, apiKeys, models, users] =
    await Promise.all([
      prisma.usageRecord.findMany({
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
        take: limit,
        where
      }),
      prisma.usageRecord.count({ where }),
      prisma.usageRecord.aggregate({
        _avg: {
          durationMs: true,
          firstTokenLatencyMs: true
        },
        _sum: {
          cachedPromptTokens: true,
          completionTokens: true,
          estimatedCostCents: true,
          promptTokens: true,
          reasoningTokens: true,
          totalTokens: true
        },
        where
      }),
      prisma.usageRecord.count({
        where: { AND: [where, { usageSource: { startsWith: "user_api:" } }] }
      }),
      prisma.usageRecord.count({
        where: {
          AND: [
            where,
            { conversationId: { not: null }, mode: "CHAT", NOT: { usageSource: { startsWith: "user_api:" } } }
          ]
        }
      }),
      prisma.usageRecord.count({ where: { AND: [where, { mode: "IMAGE" }] } }),
      prisma.usageRecord.count({
        where: {
          AND: [
            where,
            { conversationId: null, mode: "CHAT", NOT: { usageSource: { startsWith: "user_api:" } } }
          ]
        }
      }),
      prisma.userApiKey.findMany({
        orderBy: [{ userId: "asc" }, { createdAt: "desc" }],
        select: {
          keyPrefix: true,
          name: true,
          user: {
            select: {
              email: true,
              name: true
            }
          },
          userId: true
        }
      }),
      prisma.usageRecord.findMany({
        distinct: ["model"],
        orderBy: { model: "asc" },
        select: { model: true },
        where: { model: { not: "" } }
      }),
      prisma.user.findMany({
        orderBy: { email: "asc" },
        select: {
          email: true,
          id: true,
          name: true
        }
      })
    ]);
  const apiKeyNames = new Map(apiKeys.map((key) => [`${key.userId}:${key.keyPrefix}`, key.name]));
  const usageRecords = records.map((record) => serializeUsageRecord(record, apiKeyNames));

  if (csv) {
    return csvResponse(usageRecords);
  }

  const promptTokens = totals._sum.promptTokens ?? 0;
  const cachedPromptTokens = totals._sum.cachedPromptTokens ?? 0;

  return NextResponse.json({
    filterOptions: {
      apiKeys: apiKeys.map((key) => ({
        id: key.keyPrefix,
        label: `${key.name}（${key.keyPrefix}...）`,
        userLabel: key.user.name ? `${key.user.name} · ${key.user.email}` : key.user.email
      })),
      models: models.map((item) => item.model),
      users: users.map((user) => ({
        id: user.id,
        label: user.name ? `${user.name} · ${user.email}` : user.email
      }))
    },
    generatedAt: new Date().toISOString(),
    limit,
    records: usageRecords,
    summary: {
      apiCalls,
      avgDurationMs: totals._avg.durationMs,
      avgFirstTokenLatencyMs: totals._avg.firstTokenLatencyMs,
      cachedPromptTokens,
      cacheRate: promptTokens > 0 ? cachedPromptTokens / promptTokens : 0,
      chatCalls,
      completionTokens: totals._sum.completionTokens ?? 0,
      costCents: totals._sum.estimatedCostCents ?? 0,
      imageCalls,
      promptTokens,
      reasoningTokens: totals._sum.reasoningTokens ?? 0,
      records: totalCount,
      returnedRecords: usageRecords.length,
      taskCalls,
      totalTokens: totals._sum.totalTokens ?? 0
    }
  });
}
