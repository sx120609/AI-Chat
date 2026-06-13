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

function usageSurface(record: UsageRecordItem) {
  if (record.mode === "IMAGE") {
    return "图片";
  }

  return record.conversationId ? "聊天" : "个人 API";
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");

  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function usageCsv(records: UsageRecordItem[]) {
  const header = [
    "id",
    "createdAt",
    "surface",
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
  const rows = records.map((record) => [
    record.id,
    record.createdAt.toISOString(),
    usageSurface(record),
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
  ]);

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
    orderBy: { createdAt: "desc" },
    take: 2000
  });

  if (request.nextUrl.searchParams.get("format") === "csv") {
    return new Response(usageCsv(records), {
      headers: {
        "content-disposition": `attachment; filename="usage-${new Date().toISOString().slice(0, 10)}.csv"`,
        "content-type": "text/csv; charset=utf-8"
      }
    });
  }

  const byModel = new Map<string, UsageBucket>();
  const byMonth = new Map<string, UsageBucket>();
  const byMode = new Map<string, UsageBucket>();
  const bySurface = new Map<string, UsageBucket>();

  for (const record of records) {
    const month = record.createdAt.toISOString().slice(0, 7);

    addToBucket(byModel, record.model, record.model, record);
    addToBucket(byMonth, month, month, record);
    addToBucket(byMode, record.mode, record.mode === "IMAGE" ? "图片" : "聊天", record);
    addToBucket(bySurface, usageSurface(record), usageSurface(record), record);
  }

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    recentRecords: records.slice(0, 50).map((record) => ({
      id: record.id,
      conversationId: record.conversationId,
      createdAt: record.createdAt.toISOString(),
      estimatedCostCents: record.estimatedCostCents,
      mode: record.mode,
      model: record.model,
      surface: usageSurface(record),
      totalTokens: record.totalTokens,
      usageSource: record.usageSource
    })),
    totals: {
      costCents: records.reduce((total, record) => total + record.estimatedCostCents, 0),
      records: records.length,
      totalTokens: records.reduce((total, record) => total + record.totalTokens, 0)
    },
    byModel: sortedBuckets(byModel),
    byMonth: sortedBuckets(byMonth),
    byMode: sortedBuckets(byMode),
    bySurface: sortedBuckets(bySurface)
  });
}
