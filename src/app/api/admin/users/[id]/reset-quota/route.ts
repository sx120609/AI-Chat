import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, requireAdmin } from "@/lib/http";
import { startNextQuotaPeriod } from "@/lib/quota";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const currentUser = await getUserFromRequest(request);
  const error = requireAdmin(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  const { id } = await context.params;

  try {
    await startNextQuotaPeriod(id);
  } catch {
    return jsonError("用户不存在。", 404);
  }

  return NextResponse.json({ ok: true });
}
