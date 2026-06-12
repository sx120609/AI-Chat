import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, readJson, requireActiveUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { serializeUserApiKey } from "@/lib/user-api-keys";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type UpdateApiKeyBody = {
  active?: boolean;
  name?: string;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const currentUser = await getUserFromRequest(request);
  const error = requireActiveUser(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  const { id } = await context.params;
  let body: UpdateApiKeyBody;

  try {
    body = await readJson<UpdateApiKeyBody>(request);
  } catch (readError) {
    return jsonError(readError instanceof Error ? readError.message : "更新 API Key 失败。", 400);
  }

  const data: { active?: boolean; name?: string } = {};

  if (typeof body.active === "boolean") {
    data.active = body.active;
  }

  if (typeof body.name === "string" && body.name.trim()) {
    data.name = body.name.trim();
  }

  if (Object.keys(data).length === 0) {
    return jsonError("没有可更新字段。", 400);
  }

  const existingKey = await prisma.userApiKey.findFirst({
    where: { id, userId: currentUser.id }
  });

  if (!existingKey) {
    return jsonError("API Key 不存在。", 404);
  }

  const key = await prisma.userApiKey.update({
    where: { id },
    data
  });

  return NextResponse.json({ key: serializeUserApiKey(key) });
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const currentUser = await getUserFromRequest(_request);
  const error = requireActiveUser(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  const { id } = await context.params;

  const deleted = await prisma.userApiKey.deleteMany({
    where: { id, userId: currentUser.id }
  });

  if (deleted.count === 0) {
    return jsonError("API Key 不存在。", 404);
  }

  return NextResponse.json({ ok: true });
}
