import { NextRequest, NextResponse } from "next/server";
import { getSharedConversation } from "@/lib/conversation-share";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    token: string;
  }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const { token } = await context.params;
  const conversation = await getSharedConversation(token);

  if (!conversation) {
    return jsonError("分享链接不存在或已失效。", 404);
  }

  return NextResponse.json({ conversation });
}
