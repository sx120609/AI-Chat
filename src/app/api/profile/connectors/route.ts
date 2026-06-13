import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import {
  listUserAppConnectors,
  normalizeAppConnectorProvider,
  updateUserAppConnector
} from "@/lib/connectors";
import { jsonError, readJson, requireActiveUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConnectorBody = {
  action?: "authorize" | "revoke";
  enabled?: boolean;
  metadata?: Record<string, unknown>;
  provider?: string;
};

export async function GET(request: NextRequest) {
  const currentUser = await getUserFromRequest(request);
  const error = requireActiveUser(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  const connectors = await listUserAppConnectors(currentUser.id, currentUser.aiStylePrompt);

  return NextResponse.json({ connectors });
}

export async function PATCH(request: NextRequest) {
  const currentUser = await getUserFromRequest(request);
  const error = requireActiveUser(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  let body: ConnectorBody;

  try {
    body = await readJson<ConnectorBody>(request);
  } catch (readError) {
    return jsonError(readError instanceof Error ? readError.message : "更新连接器失败。", 400);
  }

  const provider = normalizeAppConnectorProvider(body.provider);

  if (!provider) {
    return jsonError("未知连接器。", 400);
  }

  const action =
    body.action === "authorize" || body.action === "revoke" ? body.action : undefined;

  if (body.action && !action) {
    return jsonError("未知连接器操作。", 400);
  }

  if (!action && typeof body.enabled !== "boolean") {
    return jsonError("没有可更新的连接器状态。", 400);
  }

  const connector = await updateUserAppConnector({
    action,
    enabled: body.enabled,
    metadata:
      body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? body.metadata
        : undefined,
    provider,
    userId: currentUser.id
  });
  const refreshedUser = await prisma.user.findUnique({
    where: { id: currentUser.id },
    select: { aiStylePrompt: true }
  });

  const connectors = await listUserAppConnectors(
    currentUser.id,
    refreshedUser?.aiStylePrompt ?? currentUser.aiStylePrompt
  );

  return NextResponse.json({ connector, connectors });
}
