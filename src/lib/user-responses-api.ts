import { NextRequest } from "next/server";
import { authenticateUserApiKey } from "@/lib/user-api-keys";
import { jsonError } from "@/lib/http";
import {
  estimateChatCostForModel,
  getEnabledApiModels,
  getEnabledChatModels,
  type ChatModelConfig
} from "@/lib/models";
import { prisma } from "@/lib/prisma";
import { assertQuotaAvailable, QuotaError } from "@/lib/quota";
import { resolveApiIdentityPrompt } from "@/lib/system-prompt";
import { estimateTokens } from "@/lib/tokens";
import {
  assertUpstreamConfigured,
  getAiRuntimeSettings,
  type AiRuntimeSettings,
  type UpstreamUsage
} from "@/lib/upstream";

const decoder = new TextDecoder();
const streamEncoder = new TextEncoder();

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

function maybeDefinedEntries(entries: Array<[string, unknown]>) {
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined && value !== null));
}

function textFromMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      const object = jsonObject(part);

      if (!object) {
        return "";
      }

      if (typeof object.text === "string") {
        return object.text;
      }

      if (typeof object.content === "string") {
        return object.content;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function gatewayInstructions({
  body,
  model,
  settings
}: {
  body: Record<string, unknown>;
  model: ChatModelConfig;
  settings: AiRuntimeSettings;
}) {
  const identityPrompt = resolveApiIdentityPrompt({
    mode: settings.systemPromptMode,
    modelLabel: model.label
  });
  const callerInstructions = typeof body.instructions === "string" ? body.instructions.trim() : "";

  return [identityPrompt, callerInstructions]
    .filter(Boolean)
    .join("\n\n");
}

function upstreamRequestBody({
  body,
  model,
  settings
}: {
  body: Record<string, unknown>;
  model: ChatModelConfig;
  settings: AiRuntimeSettings;
}) {
  const instructions = gatewayInstructions({
    body,
    model,
    settings
  });

  return {
    ...body,
    ...(instructions ? { instructions } : {}),
    model: model.upstreamId || model.id
  };
}

function chatCompletionRequestToResponsesBody({
  body,
  model,
  settings
}: {
  body: Record<string, unknown>;
  model: ChatModelConfig;
  settings: AiRuntimeSettings;
}) {
  const messages = Array.isArray(body.messages) ? body.messages : null;

  if (!messages) {
    return null;
  }

  const instructionMessages: string[] = [];
  const input = messages
    .map((message) => {
      const object = jsonObject(message);

      if (!object) {
        return null;
      }

      const role = typeof object.role === "string" ? object.role : "user";
      const content = object.content ?? "";

      if (role === "system" || role === "developer") {
        const text = textFromMessageContent(content).trim();

        if (text) {
          instructionMessages.push(text);
        }

        return null;
      }

      return {
        role: role === "assistant" ? "assistant" : "user",
        content
      };
    })
    .filter(Boolean);

  const callerInstructions = [
    typeof body.instructions === "string" ? body.instructions.trim() : "",
    ...instructionMessages
  ]
    .filter(Boolean)
    .join("\n\n");

  return upstreamRequestBody({
    body: maybeDefinedEntries([
      ["input", input.length ? input : messages],
      ["instructions", callerInstructions],
      ["stream", body.stream],
      ["temperature", body.temperature],
      ["top_p", body.top_p],
      ["metadata", body.metadata],
      ["tools", body.tools],
      ["tool_choice", body.tool_choice],
      ["parallel_tool_calls", body.parallel_tool_calls],
      ["reasoning", body.reasoning],
      ["max_output_tokens", body.max_completion_tokens ?? body.max_tokens]
    ]),
    model,
    settings
  });
}

function chatUsageFromResponsesUsage({
  completionTokensEstimate,
  promptTokensEstimate,
  upstreamUsage
}: {
  completionTokensEstimate: number;
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

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: numberFromUsage(upstreamUsage?.total_tokens) || promptTokens + completionTokens
  };
}

function chatCompletionResponse({
  body,
  completionText,
  id,
  model,
  promptTokensEstimate,
  upstreamUsage
}: {
  body: Record<string, unknown>;
  completionText: string;
  id?: string;
  model: ChatModelConfig;
  promptTokensEstimate: number;
  upstreamUsage?: UpstreamUsage;
}) {
  const completionTokensEstimate = Math.max(1, estimateTokens(completionText));

  return {
    id: id || `chatcmpl_${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: typeof body.model === "string" ? body.model : model.id,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: completionText
        },
        finish_reason: "stop"
      }
    ],
    usage: chatUsageFromResponsesUsage({
      completionTokensEstimate,
      promptTokensEstimate,
      upstreamUsage
    })
  };
}

function chatCompletionChunk({
  content,
  finishReason,
  id,
  model,
  role
}: {
  content?: string;
  finishReason?: string | null;
  id: string;
  model: string;
  role?: "assistant";
}) {
  return {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: maybeDefinedEntries([
          ["role", role],
          ["content", content]
        ]),
        finish_reason: finishReason ?? null
      }
    ]
  };
}

function serializeModel(model: ChatModelConfig) {
  return {
    id: model.id,
    object: "model",
    created: 0,
    owned_by: "team-ai-gateway",
    label: model.label,
    upstream_id: model.upstreamId,
    context_window_tokens: model.contextWindowTokens,
    max_context_window_tokens: model.maxContextWindowTokens,
    context_note: model.contextNote,
    input_cents_per_million_tokens: model.inputCentsPerMillionTokens,
    cached_input_cents_per_million_tokens: model.cachedInputCentsPerMillionTokens,
    output_cents_per_million_tokens: model.outputCentsPerMillionTokens,
    supports_reasoning: model.supportsReasoning
  };
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

function mockChatCompletionBody(
  body: Record<string, unknown>,
  model: ChatModelConfig,
  promptTokensEstimate: number
) {
  const text = "Mock response from personal API.";

  return chatCompletionResponse({
    body,
    completionText: text,
    model,
    promptTokensEstimate,
    upstreamUsage: {
      input_tokens: promptTokensEstimate,
      output_tokens: estimateTokens(text),
      total_tokens: promptTokensEstimate + estimateTokens(text)
    }
  });
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

  const upstreamBody = upstreamRequestBody({
    body,
    model,
    settings
  });
  const promptTokensEstimate = promptEstimateFromBody(upstreamBody);
  const expectedCostCents = estimateChatCostForModel(model, promptTokensEstimate, 0);

  try {
    await assertQuotaAvailable(authenticated.user.id, expectedCostCents);
  } catch (error) {
    if (error instanceof QuotaError) {
      return jsonError(error.message, error.status, { usage: error.summary });
    }

    throw error;
  }

  if (settings.mockResponses) {
    const payload = mockResponsesBody(upstreamBody, model);

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

export async function handleUserChatCompletionsRequest(request: NextRequest) {
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

  const upstreamBody = chatCompletionRequestToResponsesBody({
    body,
    model,
    settings
  });

  if (!upstreamBody) {
    return jsonError("Chat Completions 请求必须包含 messages 数组。", 400);
  }

  const promptTokensEstimate = promptEstimateFromBody(upstreamBody);
  const expectedCostCents = estimateChatCostForModel(model, promptTokensEstimate, 0);

  try {
    await assertQuotaAvailable(authenticated.user.id, expectedCostCents);
  } catch (error) {
    if (error instanceof QuotaError) {
      return jsonError(error.message, error.status, { usage: error.summary });
    }

    throw error;
  }

  if (settings.mockResponses) {
    const payload = mockChatCompletionBody(body, model, promptTokensEstimate);
    const usage = payload.usage;

    await recordUserApiUsage({
      completionTokensEstimate: usage.completion_tokens,
      model,
      promptTokensEstimate,
      upstreamUsage: {
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens
      },
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

  const responseModel = typeof body.model === "string" ? body.model : model.id;

  if (body.stream === true) {
    const id = `chatcmpl_${Date.now()}`;
    let buffer = "";
    let upstreamUsage: UpstreamUsage | undefined;
    let outputText = "";
    const reader = response.body.getReader();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          controller.enqueue(
            streamEncoder.encode(
              `data: ${JSON.stringify(
                chatCompletionChunk({ id, model: responseModel, role: "assistant" })
              )}\n\n`
            )
          );

          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              break;
            }

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
                  const delta = outputTextFromPayload(payload);
                  upstreamUsage = parseUsage(payload) ?? upstreamUsage;

                  if (delta) {
                    outputText += delta;
                    controller.enqueue(
                      streamEncoder.encode(
                        `data: ${JSON.stringify(
                          chatCompletionChunk({ content: delta, id, model: responseModel })
                        )}\n\n`
                      )
                    );
                  }
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

          controller.enqueue(
            streamEncoder.encode(
              `data: ${JSON.stringify(
                chatCompletionChunk({ finishReason: "stop", id, model: responseModel })
              )}\n\n`
            )
          );
          controller.enqueue(streamEncoder.encode("data: [DONE]\n\n"));
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
      status: 200,
      headers: {
        "cache-control": "no-cache, no-transform",
        "content-type": "text/event-stream; charset=utf-8",
        "x-accel-buffering": "no"
      }
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
  const completionText = outputTextFromPayload(payload) || (typeof payload === "string" ? payload : "");
  const completionTokensEstimate = Math.max(1, estimateTokens(completionText));

  await recordUserApiUsage({
    completionTokensEstimate,
    model,
    promptTokensEstimate,
    upstreamUsage,
    userId: authenticated.user.id
  });

  const responseId =
    jsonObject(payload) && typeof jsonObject(payload)?.id === "string"
      ? (jsonObject(payload)?.id as string)
      : undefined;

  return Response.json(
    chatCompletionResponse({
      body,
      completionText,
      id: responseId,
      model,
      promptTokensEstimate,
      upstreamUsage
    })
  );
}

export async function handleUserModelsRequest(request: NextRequest) {
  const authenticated = await authenticateUserApiKey(request.headers.get("authorization"));

  if (!authenticated) {
    return jsonError("无效的 API Key，或当前账号不是 VIP 用户组。", 401);
  }

  const settings = await getAiRuntimeSettings();

  return Response.json({
    object: "list",
    data: getEnabledApiModels(settings.chatModels).map(serializeModel)
  });
}
