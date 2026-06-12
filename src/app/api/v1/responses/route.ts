import { NextRequest } from "next/server";
import { handleUserResponsesRequest } from "@/lib/user-responses-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return handleUserResponsesRequest(request);
}
