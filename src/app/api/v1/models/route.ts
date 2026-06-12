import { NextRequest } from "next/server";
import { handleUserModelsRequest } from "@/lib/user-responses-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleUserModelsRequest(request);
}
