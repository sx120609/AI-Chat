import { NextRequest } from "next/server";
import {
  handleUserGeminiModelsRequest,
  handleUserGeminiRequest,
  withUserApiConcurrency
} from "@/lib/user-responses-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const path = (await context.params).path.join("/");
  const model = path.match(/^models\/(.+)$/)?.[1];

  return model
    ? handleUserGeminiModelsRequest(request, model)
    : Response.json(
        { error: { code: 404, message: "接口不存在。", status: "NOT_FOUND" } },
        { status: 404 }
      );
}

export async function POST(request: NextRequest, context: RouteContext) {
  const path = (await context.params).path.join("/");
  const match = path.match(/^models\/(.+):(generateContent|streamGenerateContent|countTokens)$/);

  if (!match) {
    return Response.json(
      { error: { code: 404, message: "接口不存在。", status: "NOT_FOUND" } },
      { status: 404 }
    );
  }

  const handler = () => handleUserGeminiRequest(request, {
    requestedModel: match[1],
    action: match[2]
  });

  return match[2] === "countTokens"
    ? handler()
    : withUserApiConcurrency(request, handler);
}
