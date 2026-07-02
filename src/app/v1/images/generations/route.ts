import { NextRequest } from "next/server";
import { handleUserImageGenerationsRequest } from "@/lib/user-responses-api";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return handleUserImageGenerationsRequest(request);
}
