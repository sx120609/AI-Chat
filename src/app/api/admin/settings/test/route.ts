import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, requireAdmin } from "@/lib/http";
import { isLikelyChatModelId } from "@/lib/models";
import { fetchUpstreamModelIds, getAiRuntimeSettings } from "@/lib/upstream";

export const runtime = "nodejs";

type DiagnosticCheck = {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
};

function baseUrlChecks(baseUrl: string) {
  const checks: DiagnosticCheck[] = [];

  try {
    const url = new URL(baseUrl);

    checks.push({
      name: "API 地址格式",
      status: url.protocol === "http:" || url.protocol === "https:" ? "ok" : "error",
      message: baseUrl
    });

    checks.push({
      name: "OpenAI 兼容路径",
      status: url.pathname.replace(/\/+$/, "").endsWith("/v1") ? "ok" : "warn",
      message: url.pathname.replace(/\/+$/, "").endsWith("/v1")
        ? "Base URL 已包含 /v1。"
        : "多数 Sub2API / One API 网关需要以 /v1 结尾。"
    });
  } catch {
    checks.push({
      name: "API 地址格式",
      status: "error",
      message: "不是有效 URL。"
    });
  }

  return checks;
}

export async function POST(request: NextRequest) {
  const currentUser = await getUserFromRequest(request);
  const error = requireAdmin(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  const settings = await getAiRuntimeSettings();
  const checks = baseUrlChecks(settings.apiBaseUrl);

  if (settings.mockResponses) {
    checks.push({
      name: "Mock 模式",
      status: "warn",
      message: "当前开启 Mock，后端不会访问真实上游。"
    });

    return NextResponse.json({ ok: false, checks, modelCount: 0, chatModelCount: 0, sample: [] });
  }

  if (!settings.apiKey) {
    checks.push({
      name: "API Key",
      status: "error",
      message: "未设置 API Key。"
    });

    return NextResponse.json({ ok: false, checks, modelCount: 0, chatModelCount: 0, sample: [] });
  }

  checks.push({
    name: "API Key",
    status: "ok",
    message: "Key 已在后端保存，未返回给前端。"
  });

  try {
    const modelIds = await fetchUpstreamModelIds(settings);
    const chatModelIds = modelIds.filter(isLikelyChatModelId);

    checks.push({
      name: "/models",
      status: "ok",
      message: `上游返回 ${modelIds.length} 个模型，其中 ${chatModelIds.length} 个看起来可用于聊天。`
    });

    if (chatModelIds.length === 0) {
      checks.push({
        name: "聊天模型",
        status: "warn",
        message: "没有识别到聊天模型，请检查上游模型权限或手动模型映射。"
      });
    }

    return NextResponse.json({
      ok: checks.every((item) => item.status !== "error"),
      checks,
      modelCount: modelIds.length,
      chatModelCount: chatModelIds.length,
      sample: modelIds.slice(0, 12)
    });
  } catch (testError) {
    checks.push({
      name: "/models",
      status: "error",
      message: testError instanceof Error ? testError.message : "无法访问上游模型列表。"
    });

    return NextResponse.json({
      ok: false,
      checks,
      modelCount: 0,
      chatModelCount: 0,
      sample: []
    });
  }
}
