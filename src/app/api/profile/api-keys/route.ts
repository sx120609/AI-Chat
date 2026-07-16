import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import {
  createUserApiKey,
  getUserApiKeyUsageSummary,
  serializeUserApiKey
} from "@/lib/user-api-keys";
import { canUsePersonalApi } from "@/lib/user-groups";
import { jsonError, readJson, requireActiveUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type CreateApiKeyBody = {
  name?: string;
  usageCostLimitCents?: number;
};

function normalizeUsageCostLimit(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed)
    ? Math.min(100_000_000, Math.max(0, Math.round(parsed)))
    : 0;
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

  const keys = await prisma.userApiKey.findMany({
    where: { userId: currentUser.id },
    orderBy: { createdAt: "desc" }
  });

  return NextResponse.json({
    canCreate: canUsePersonalApi(currentUser),
    keys: await Promise.all(
      keys.map(async (key) => serializeUserApiKey(key, await getUserApiKeyUsageSummary(key)))
    )
  });
}

export async function POST(request: NextRequest) {
  const currentUser = await getUserFromRequest(request);
  const error = requireActiveUser(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  if (!canUsePersonalApi(currentUser)) {
    return jsonError("仅 VIP 用户组或有效的 Coding Plan 可创建个人 API。", 403);
  }

  let body: CreateApiKeyBody;

  try {
    body = await readJson<CreateApiKeyBody>(request);
  } catch (readError) {
    return jsonError(readError instanceof Error ? readError.message : "创建 API Key 失败。", 400);
  }

  const result = await createUserApiKey(
    currentUser.id,
    body.name || "个人 API Key",
    normalizeUsageCostLimit(body.usageCostLimitCents)
  );

  return NextResponse.json(result, { status: 201 });
}
