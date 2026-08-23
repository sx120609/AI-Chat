import { NextRequest } from "next/server";
import { handleUserImageGenerationsRequest, withUserApiConcurrency } from "@/lib/user-responses-api";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return withUserApiConcurrency(request, () => handleUserImageGenerationsRequest(request));
}
