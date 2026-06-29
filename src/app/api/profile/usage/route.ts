import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, requireActiveUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UsageRecordItem = {
  billingMode: string;
  cachedPromptTokens: number;
  completionTokens: number;
  conversationId: string | null;
  createdAt: Date;
  durationMs: number | null;
  endpoint: string;
  estimatedCostCents: number;
  firstTokenLatencyMs: number | null;
  id: string;
  messageId: string | null;
  mode: string;
  model: string;
  promptTokens: number;
  quotaSource: string;
  requestKind: string;
  reasoningEffort: string;
  reasoningTokens: number;
  totalTokens: number;
  usageSource: string;
};

type UsageBucket = {
  cachedPromptTokens: number;
  completionTokens: number;
  costCents: number;
  key: string;
  label: string;
  promptTokens: number;
  reasoningTokens: number;
  records: number;
  totalTokens: number;
};

type ApiKeyUsageInfo = {
  key: string;
  label: string;
};

function isPersonalApiUsage(record: UsageRecordItem) {
  return record.usageSource.startsWith("user_api:");
}

function usageApiKeyInfo(record: UsageRecordItem, apiKeyNames: Map<string, string>): ApiKeyUsageInfo | null {
  if (!isPersonalApiUsage(record)) {
    return null;
  }

  const segments = record.usageSource.split(":");

  if (segments.length >= 3 && segments[1]) {
    const prefix = segments[1];
    const name = apiKeyNames.get(prefix);

    return {
      key: `api_key:${prefix}`,
      label: name ? `${name}（${prefix}...）` : `API Key ${prefix}...`
    };
  }

  return {
    key: "api_key:legacy",
    label: "个人 API（旧记录）"
  };
}

function addToBucket(map: Map<string, UsageBucket>, key: string, label: string, record: UsageRecordItem) {
  const bucket =
    map.get(key) ??
    {
      cachedPromptTokens: 0,
      completionTokens: 0,
      costCents: 0,
      key,
      label,
      promptTokens: 0,
      reasoningTokens: 0,
      records: 0,
      totalTokens: 0
    };

  bucket.cachedPromptTokens += record.cachedPromptTokens;
  bucket.completionTokens += record.completionTokens;
  bucket.costCents += record.estimatedCostCents;
  bucket.promptTokens += record.promptTokens;
  bucket.reasoningTokens += record.reasoningTokens;
  bucket.records += 1;
  bucket.totalTokens += record.totalTokens;
  map.set(key, bucket);
}

function sortedBuckets(map: Map<string, UsageBucket>) {
  return [...map.values()].sort((a, b) => b.costCents - a.costCents || b.totalTokens - a.totalTokens);
}

function sortedMonthBuckets(map: Map<string, UsageBucket>) {
  return [...map.values()].sort((a, b) => b.key.localeCompare(a.key));
}

function usageSurface(record: UsageRecordItem) {
  if (record.mode === "IMAGE") {
    return "图片";
  }

  if (isPersonalApiUsage(record)) {
    return "个人 API";
  }

  return record.conversationId ? "聊天" : "任务";
}

function fallbackEndpoint(record: UsageRecordItem) {
  if (isPersonalApiUsage(record)) {
    return "个人 API";
  }

  if (record.mode === "IMAGE") {
    return "图片";
  }

  return record.conversationId ? "/api/chat" : "task";
}

function fallbackRequestKind(record: UsageRecordItem) {
  if (record.mode === "IMAGE" || !record.conversationId) {
    return "sync";
  }

  return "stream";
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");

  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function boundedInteger(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function usageCsv(records: UsageRecordItem[], apiKeyNames: Map<string, string>) {
  const header = [
    "id",
    "createdAt",
    "surface",
    "apiKey",
    "mode",
    "model",
    "conversationId",
    "promptTokens",
    "completionTokens",
    "cachedPromptTokens",
    "reasoningTokens",
    "totalTokens",
    "estimatedCostCents",
    "endpoint",
    "requestKind",
    "billingMode",
    "quotaSource",
    "firstTokenLatencyMs",
    "durationMs",
    "usageSource"
  ];
  const rows = records.map((record) => {
    const apiKeyInfo = usageApiKeyInfo(record, apiKeyNames);

    return [
      record.id,
      record.createdAt.toISOString(),
      usageSurface(record),
      apiKeyInfo?.label ?? "",
      record.mode,
      record.model,
      record.conversationId ?? "",
      record.promptTokens,
      record.completionTokens,
      record.cachedPromptTokens,
      record.reasoningTokens,
      record.totalTokens,
      record.estimatedCostCents,
      record.endpoint || fallbackEndpoint(record),
      record.requestKind || fallbackRequestKind(record),
      record.billingMode,
      record.quotaSource,
      record.firstTokenLatencyMs ?? "",
      record.durationMs ?? "",
      record.usageSource
    ];
  });

  return [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
}

export async function GET(request: NextRequest) {
  const currentUser = await getUserFromRequest(request);
  const error = requireActiveUser(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  const records = await prisma.usageRecord.findMany({
    where: { userId: currentUser.id },
    orderBy: { createdAt: "desc" }
  });
  const apiKeys = await prisma.userApiKey.findMany({
    where: { userId: currentUser.id },
    select: { keyPrefix: true, name: true }
  });
  const apiKeyNames = new Map(apiKeys.map((apiKey) => [apiKey.keyPrefix, apiKey.name]));

  if (request.nextUrl.searchParams.get("format") === "csv") {
    return new Response(usageCsv(records, apiKeyNames), {
      headers: {
        "content-disposition": `attachment; filename="usage-${new Date().toISOString().slice(0, 10)}.csv"`,
        "content-type": "text/csv; charset=utf-8"
      }
    });
  }

  const byModel = new Map<string, UsageBucket>();
  const byDay = new Map<string, UsageBucket>();
  const byMonth = new Map<string, UsageBucket>();
  const byMode = new Map<string, UsageBucket>();
  const bySurface = new Map<string, UsageBucket>();
  const byApiKey = new Map<string, UsageBucket>();
  const recordsLimit = boundedInteger(
    request.nextUrl.searchParams.get("recordsLimit") ?? request.nextUrl.searchParams.get("limit"),
    50,
    10,
    100
  );
  const recordsOffset = boundedInteger(
    request.nextUrl.searchParams.get("recordsOffset") ?? request.nextUrl.searchParams.get("offset"),
    0,
    0,
    1_000_000
  );
  const visibleRecords = records.slice(recordsOffset, recordsOffset + recordsLimit);
  const promptTokens = records.reduce((total, record) => total + record.promptTokens, 0);
  const completionTokens = records.reduce((total, record) => total + record.completionTokens, 0);
  const cachedPromptTokens = records.reduce((total, record) => total + record.cachedPromptTokens, 0);
  const reasoningTokens = records.reduce((total, record) => total + record.reasoningTokens, 0);
  const totalTokens = records.reduce((total, record) => total + record.totalTokens, 0);
  const costCents = records.reduce((total, record) => total + record.estimatedCostCents, 0);

  for (const record of records) {
    const day = record.createdAt.toISOString().slice(0, 10);
    const month = record.createdAt.toISOString().slice(0, 7);
    const apiKeyInfo = usageApiKeyInfo(record, apiKeyNames);

    addToBucket(byModel, record.model, record.model, record);
    addToBucket(byDay, day, day, record);
    addToBucket(byMonth, month, month, record);
    addToBucket(byMode, record.mode, record.mode === "IMAGE" ? "图片" : "聊天", record);
    addToBucket(bySurface, usageSurface(record), usageSurface(record), record);

    if (apiKeyInfo) {
      addToBucket(byApiKey, apiKeyInfo.key, apiKeyInfo.label, record);
    }
  }

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    recordsHasMore: recordsOffset + visibleRecords.length < records.length,
    recordsLimit,
    recordsOffset,
    recordsTotal: records.length,
    recentRecords: visibleRecords.map((record) => {
      const apiKeyInfo = usageApiKeyInfo(record, apiKeyNames);

      return {
        id: record.id,
        apiKeyLabel: apiKeyInfo?.label ?? null,
        billingMode: record.billingMode,
        cachedPromptTokens: record.cachedPromptTokens,
        completionTokens: record.completionTokens,
        conversationId: record.conversationId,
        createdAt: record.createdAt.toISOString(),
        durationMs: record.durationMs,
        endpoint: record.endpoint || fallbackEndpoint(record),
        estimatedCostCents: record.estimatedCostCents,
        firstTokenLatencyMs: record.firstTokenLatencyMs,
        messageId: record.messageId,
        mode: record.mode,
        model: record.model,
        promptTokens: record.promptTokens,
        quotaSource: record.quotaSource,
        reasoningEffort: record.reasoningEffort,
        reasoningTokens: record.reasoningTokens,
        requestKind: record.requestKind || fallbackRequestKind(record),
        surface: usageSurface(record),
        totalTokens: record.totalTokens,
        usageSource: record.usageSource
      };
    }),
    totals: {
      cacheRate: promptTokens > 0 ? cachedPromptTokens / promptTokens : 0,
      cachedPromptTokens,
      completionTokens,
      costCents,
      promptTokens,
      reasoningTokens,
      records: records.length,
      totalTokens
    },
    byApiKey: sortedBuckets(byApiKey),
    byDay: sortedMonthBuckets(byDay),
    byModel: sortedBuckets(byModel),
    byMonth: sortedMonthBuckets(byMonth),
    byMode: sortedBuckets(byMode),
    bySurface: sortedBuckets(bySurface)
  });
}
