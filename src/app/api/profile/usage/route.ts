import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, requireActiveUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UsageRecordItem = {
  cachedPromptTokens: number;
  completionTokens: number;
  conversationId: string | null;
  createdAt: Date;
  estimatedCostCents: number;
  id: string;
  mode: string;
  model: string;
  promptTokens: number;
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

function csvEscape(value: unknown) {
  const text = String(value ?? "");

  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
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
    recentRecords: records.slice(0, 50).map((record) => {
      const apiKeyInfo = usageApiKeyInfo(record, apiKeyNames);

      return {
        id: record.id,
        apiKeyLabel: apiKeyInfo?.label ?? null,
        conversationId: record.conversationId,
        createdAt: record.createdAt.toISOString(),
        estimatedCostCents: record.estimatedCostCents,
        mode: record.mode,
        model: record.model,
        surface: usageSurface(record),
        totalTokens: record.totalTokens,
        usageSource: record.usageSource
      };
    }),
    totals: {
      costCents: records.reduce((total, record) => total + record.estimatedCostCents, 0),
      records: records.length,
      totalTokens: records.reduce((total, record) => total + record.totalTokens, 0)
    },
    byApiKey: sortedBuckets(byApiKey),
    byDay: sortedMonthBuckets(byDay),
    byModel: sortedBuckets(byModel),
    byMonth: sortedMonthBuckets(byMonth),
    byMode: sortedBuckets(byMode),
    bySurface: sortedBuckets(bySurface)
  });
}
