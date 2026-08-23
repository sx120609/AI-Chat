import { NextRequest } from "next/server";
import { handleUserAlphaSearchRequest, withUserApiConcurrency } from "@/lib/user-responses-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return withUserApiConcurrency(request, () => handleUserAlphaSearchRequest(request));
}
