import { NextRequest } from "next/server";
import { authenticateUserApiKey } from "@/lib/user-api-keys";
import { jsonError } from "@/lib/http";
import {
  estimateChatCostForModel,
  getEnabledChatModels,
  type ChatModelConfig
} from "@/lib/models";
import { prisma } from "@/lib/prisma";
import { assertQuotaAvailable, QuotaError } from "@/lib/quota";
import { estimateTokens } from "@/lib/tokens";
import {
  assertUpstreamConfigured,
  getAiRuntimeSettings,
  type UpstreamUsage
} from "@/lib/upstream";

export const USER_RESPONSES_RUNTIME = "nodejs";

const decoder = new TextDecoder();

function numberFromUsage(value: unknown) {
  const parsed = typeof value === "string" ? Number(value) : value;

  return typeof parsed === "number" && Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function costCentsFromUsage(value: unknown) {
  const parsed = typeof value === "string" ? Number(value) : value;

  return typeof parsed === "number" && Number.isFinite(parsed)
    ? Math.max(0, parsed * 100)
    : 0;
}

function usageToJson(upstreamUsage: UpstreamUsage | undefined) {
  if (!upstreamUsage) {
    return null;
  }

  try {
    return JSON.stringify(upstreamUsage).slice(0, 8000);
  } catch {
    return null;
  }
}

function parseUsage(payload: unknown): UpstreamUsage | undefined {
  const json = payload as {
    response?: { usage?: UpstreamUsage | null } | null;
    usage?: UpstreamUsage | null;
  };

  return json.usage ?? json.response?.usage ?? undefined;
}

function outputTextFromPayload(payload: unknown) {
  const json = payload as {
    choices?: Array<{ delta?: { content?: string }; message?: { content?: string }; text?: string }>;
    delta?: unknown;
    output?: Array<{ content?: Array<{ text?: string; type?: string }> }>;
    output_text?: unknown;
    text?: unknown;
    type?: unknown;
  };

  if (typeof json.output_text === "string") {
    return json.output_text;
  }

  if (typeof json.text === "string") {
    return json.text;
  }

  if (json.type === "response.output_text.delta" && typeof json.delta === "string") {
    return json.delta;
  }

  const choicesText =
    json.choices
      ?.map((choice) => choice.delta?.content ?? choice.message?.content ?? choice.text ?? "")
      .join("") ?? "";

  if (choicesText) {
    return choicesText;
  }

  return (
    json.output
      ?.flatMap((item) => item.content ?? [])
      .map((item) => item.text ?? "")
      .join("") ?? ""
  );
}

function resolveTokenUsage({
  completionTokensEstimate,
  model,
  promptTokensEstimate,
  upstreamUsage
}: {
  completionTokensEstimate: number;
  model: ChatModelConfig;
  promptTokensEstimate: number;
  upstreamUsage?: UpstreamUsage;
}) {
  const promptTokens =
    numberFromUsage(upstreamUsage?.prompt_tokens) ||
    numberFromUsage(upstreamUsage?.input_tokens) ||
    promptTokensEstimate;
  const completionTokens =
    numberFromUsage(upstreamUsage?.completion_tokens) ||
    numberFromUsage(upstreamUsage?.output_tokens) ||
    completionTokensEstimate;
  const totalTokens =
    numberFromUsage(upstreamUsage?.total_tokens) || promptTokens + completionTokens;
  const cachedPromptTokens = Math.min(
    promptTokens,
    numberFromUsage(upstreamUsage?.prompt_tokens_details?.cached_tokens) ||
      numberFromUsage(upstreamUsage?.input_token_details?.cached_tokens) ||
      numberFromUsage(upstreamUsage?.cached_tokens) ||
      numberFromUsage(upstreamUsage?.prompt_cache_hit_tokens) ||
      numberFromUsage(upstreamUsage?.cache_read_input_tokens)
  );
  const reasoningTokens =
    numberFromUsage(upstreamUsage?.completion_tokens_details?.reasoning_tokens) ||
    numberFromUsage(upstreamUsage?.output_token_details?.reasoning_tokens);
  const upstreamCostCents =
    costCentsFromUsage(upstreamUsage?.cost) ||
    costCentsFromUsage(upstreamUsage?.total_cost) ||
    costCentsFromUsage(upstreamUsage?.cost_usd);

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cachedPromptTokens,
    reasoningTokens,
    usageSource: upstreamUsage ? "upstream" : "estimated",
    upstreamUsageJson: usageToJson(upstreamUsage),
    estimatedCostCents:
      upstreamCostCents ||
      estimateChatCostForModel(model, promptTokens, completionTokens, cachedPromptTokens)
  };
}

function upstreamHeaders(settings: { apiKey: string; orgId: string }) {
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };

  if (settings.apiKey) {
    headers.authorization = `Bearer ${settings.apiKey}`;
  }

  if (settings.orgId) {
    headers["openai-organization"] = settings.orgId;
  }

  return headers;
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function findEnabledModel(modelId: unknown, catalog: ChatModelConfig[]) {
  if (typeof modelId !== "string" || !modelId.trim()) {
    return null;
  }

  const id = modelId.trim();

  return getEnabledChatModels(catalog).find((model) => model.id === id || model.upstreamId === id) ?? null;
}

function promptEstimateFromBody(body: Record<string, unknown>) {
  return Math.max(1, estimateTokens(JSON.stringify(body.input ?? body.messages ?? body)));
}

async function recordUserApiUsage({
  completionTokensEstimate,
  model,
  promptTokensEstimate,
  upstreamUsage,
  userId
}: {
  completionTokensEstimate: number;
  model: ChatModelConfig;
  promptTokensEstimate: number;
  upstreamUsage?: UpstreamUsage;
  userId: string;
}) {
  const tokenUsage = resolveTokenUsage({
    completionTokensEstimate,
    model,
    promptTokensEstimate,
    upstreamUsage
  });

  await prisma.usageRecord.create({
    data: {
      userId,
      model: model.id,
      mode: "CHAT",
      promptTokens: tokenUsage.promptTokens,
      completionTokens: tokenUsage.completionTokens,
      totalTokens: tokenUsage.totalTokens,
      cachedPromptTokens: tokenUsage.cachedPromptTokens,
      reasoningTokens: tokenUsage.reasoningTokens,
      usageSource: `user_api:${tokenUsage.usageSource}`,
      upstreamUsageJson: tokenUsage.upstreamUsageJson,
      estimatedCostCents: tokenUsage.estimatedCostCents
    }
  });
}

function passthroughHeaders(response: Response) {
  const headers = new Headers();
  const contentType = response.headers.get("content-type");

  if (contentType) {
    headers.set("content-type", contentType);
  }

  return headers;
}

function mockResponsesBody(body: Record<string, unknown>, model: ChatModelConfig) {
  const text = "Mock response from personal API.";

  return {
    id: `resp_mock_${Date.now()}`,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    model: body.model ?? model.id,
    output: [
      {
        id: `msg_mock_${Date.now()}`,
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text }]
      }
    ],
    output_text: text,
    usage: {
      input_tokens: promptEstimateFromBody(body),
      output_tokens: estimateTokens(text),
      total_tokens: promptEstimateFromBody(body) + estimateTokens(text)
    }
  };
}

export async function handleUserResponsesRequest(request: NextRequest) {
  const authenticated = await authenticateUserApiKey(request.headers.get("authorization"));

  if (!authenticated) {
    return jsonError("无效的 API Key，或当前账号不是 VIP 用户组。", 401);
  }

  let body: Record<string, unknown>;

  try {
    const parsed = await request.json();
    const object = jsonObject(parsed);

    if (!object) {
      return jsonError("请求体必须是 JSON 对象。", 400);
    }

    body = object;
  } catch {
    return jsonError("请求体必须是有效 JSON。", 400);
  }

  const settings = await getAiRuntimeSettings();
  const model = findEnabledModel(body.model, settings.chatModels);

  if (!model) {
    return jsonError("模型不可用或未启用。", 400);
  }

  const promptTokensEstimate = promptEstimateFromBody(body);
  const expectedCostCents = estimateChatCostForModel(model, promptTokensEstimate, 0);

  try {
    await assertQuotaAvailable(authenticated.user.id, expectedCostCents);
  } catch (error) {
    if (error instanceof QuotaError) {
      return jsonError(error.message, error.status, { usage: error.summary });
    }

    throw error;
  }

  const upstreamBody = {
    ...body,
    model: model.upstreamId || model.id
  };

  if (settings.mockResponses) {
    const payload = mockResponsesBody(body, model);

    await recordUserApiUsage({
      completionTokensEstimate: numberFromUsage(payload.usage.output_tokens),
      model,
      promptTokensEstimate,
      upstreamUsage: payload.usage,
      userId: authenticated.user.id
    });

    return Response.json(payload);
  }

  try {
    assertUpstreamConfigured(settings);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "上游 API 未配置。", 500);
  }

  const response = await fetch(`${settings.apiBaseUrl}/responses`, {
    method: "POST",
    headers: upstreamHeaders(settings),
    body: JSON.stringify(upstreamBody),
    signal: request.signal
  });

  if (!response.ok || !response.body) {
    const text = await response.text();

    return new Response(text || "上游 API 调用失败。", {
      status: response.status,
      headers: passthroughHeaders(response)
    });
  }

  if (body.stream === true) {
    let buffer = "";
    let upstreamUsage: UpstreamUsage | undefined;
    let outputText = "";
    const reader = response.body.getReader();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              break;
            }

            controller.enqueue(value);
            buffer += decoder.decode(value, { stream: true });

            let boundary = buffer.indexOf("\n\n");

            while (boundary >= 0) {
              const event = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);

              for (const line of event.split(/\r?\n/)) {
                if (!line.startsWith("data:")) {
                  continue;
                }

                const data = line.slice(5).trim();

                if (!data || data === "[DONE]") {
                  continue;
                }

                try {
                  const payload = JSON.parse(data);
                  upstreamUsage = parseUsage(payload) ?? upstreamUsage;
                  outputText += outputTextFromPayload(payload);
                } catch {
                  // Ignore non-JSON SSE data from custom providers.
                }
              }

              boundary = buffer.indexOf("\n\n");
            }
          }

          await recordUserApiUsage({
            completionTokensEstimate: Math.max(1, estimateTokens(outputText)),
            model,
            promptTokensEstimate,
            upstreamUsage,
            userId: authenticated.user.id
          });
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
      cancel() {
        reader.cancel().catch(() => undefined);
      }
    });

    return new Response(stream, {
      status: response.status,
      headers: passthroughHeaders(response)
    });
  }

  const text = await response.text();
  let payload: unknown = text;

  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    // Some compatible providers return plain text for successful calls.
  }

  const upstreamUsage = parseUsage(payload);

  await recordUserApiUsage({
    completionTokensEstimate: Math.max(1, estimateTokens(outputTextFromPayload(payload))),
    model,
    promptTokensEstimate,
    upstreamUsage,
    userId: authenticated.user.id
  });

  return new Response(text, {
    status: response.status,
    headers: passthroughHeaders(response)
  });
}
