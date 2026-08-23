import { NextRequest } from "next/server";
import { handleUserGeminiModelsRequest } from "@/lib/user-responses-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleUserGeminiModelsRequest(request);
}
