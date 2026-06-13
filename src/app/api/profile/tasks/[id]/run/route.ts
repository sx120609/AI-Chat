import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, requireActiveUser } from "@/lib/http";
import { getUsageSummary } from "@/lib/quota";
import { runUserTask } from "@/lib/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const currentUser = await getUserFromRequest(request);
  const error = requireActiveUser(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  const { id } = await context.params;
  const result = await runUserTask({
    signal: request.signal,
    taskId: id,
    userId: currentUser.id
  });

  if (result.error) {
    return jsonError(result.error, 502);
  }

  return NextResponse.json({
    ...result,
    usage: await getUsageSummary(currentUser.id, { readCache: false })
  });
}
