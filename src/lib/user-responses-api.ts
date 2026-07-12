import { NextRequest } from "next/server";
import { authenticateUserApiKey } from "@/lib/user-api-keys";
import { jsonError } from "@/lib/http";
import {
  DEFAULT_IMAGE_SIZE,
  DEFAULT_IMAGE_UPSTREAM_MODEL,
  estimateChatCostForModel,
  estimateImageCostCents,
  getEnabledApiModels,
  IMAGE_MODEL,
  imageSizeDimensions,
  normalizeImageSize,
  type ChatModelConfig
} from "@/lib/models";
import {
  assertQuotaAvailable,
  createUsageRecordWithQuotaDebit,
  QuotaError
} from "@/lib/quota";
import { resolveApiIdentityPrompt } from "@/lib/system-prompt";
import { estimateTokens } from "@/lib/tokens";
import {
  assertUpstreamConfigured,
  generateImage,
  getAiRuntimeSettings,
  resolveUpstreamSettingsForModel,
  type AiRuntimeSettings,
  type UpstreamUsage
} from "@/lib/upstream";

const decoder = new TextDecoder();

type UpstreamResponsesResult =
  | {
      response: ResponseWithBody;
    }
  | {
      failure: UpstreamFailure;
    };

type ResponseWithBody = Response & {
  body: ReadableStream<Uint8Array>;
};

type UpstreamFailure = {
  message: string;
  status: number;
  upstreamBody?: string;
};

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
      numberFromUsage(upstreamUsage?.input_tokens_details?.cached_tokens) ||
      numberFromUsage(upstreamUsage?.input_token_details?.cached_tokens) ||
      numberFromUsage(upstreamUsage?.cached_tokens) ||
      numberFromUsage(upstreamUsage?.prompt_cache_hit_tokens) ||
      numberFromUsage(upstreamUsage?.cache_read_input_tokens)
  );
  const reasoningTokens =
    numberFromUsage(upstreamUsage?.completion_tokens_details?.reasoning_tokens) ||
    numberFromUsage(upstreamUsage?.output_tokens_details?.reasoning_tokens) ||
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

const SUB2API_PASSTHROUGH_HEADERS = [
  "chatgpt-account-id",
  "session_id",
  "x-codex-installation-id",
  "x-codex-window-id"
];

function upstreamHeaders(settings: { apiKey: string; orgId: string }, incomingHeaders?: Headers) {
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };

  if (settings.apiKey) {
    headers.authorization = `Bearer ${settings.apiKey}`;
  }

  if (settings.orgId) {
    headers["openai-organization"] = settings.orgId;
  }

  SUB2API_PASSTHROUGH_HEADERS.forEach((name) => {
    const value = incomingHeaders?.get(name);

    if (value) {
      headers[name] = value;
    }
  });

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
  const apiModels = getEnabledApiModels(catalog);
  const exactApiModel =
    apiModels.find((model) => model.id === id || model.upstreamId === id || model.label === id) ?? null;

  if (exactApiModel) {
    return exactApiModel;
  }

  const normalizedId = id.toLowerCase();
  const chatModel = catalog.find(
    (model) =>
      model.enabled &&
      (model.id.toLowerCase() === normalizedId ||
        model.upstreamId.toLowerCase() === normalizedId ||
        model.label.toLowerCase() === normalizedId)
  );

  return chatModel
    ? apiModels.find((model) => model.upstreamId === chatModel.upstreamId) ?? null
    : null;
}

function promptEstimateFromBody(body: Record<string, unknown>) {
  return Math.max(1, estimateTokens(JSON.stringify(body.input ?? body.messages ?? body)));
}

function promptEstimateFromImagePrompt(prompt: string) {
  return Math.max(1, estimateTokens(prompt));
}

function normalizeImageCount(value: unknown) {
  if (value === undefined || value === null) {
    return 1;
  }

  const parsed = typeof value === "string" ? Number(value) : value;

  if (typeof parsed !== "number" || !Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return null;
  }

  if (parsed < 1 || parsed > 4) {
    return null;
  }

  return parsed;
}

function normalizeImageResponseFormat(value: unknown) {
  return value === "b64_json" ? "b64_json" : "url";
}

function isAllowedImageModel(modelId: unknown, settings: AiRuntimeSettings) {
  if (modelId === undefined || modelId === null || modelId === "") {
    return true;
  }

  if (typeof modelId !== "string") {
    return false;
  }

  const normalized = modelId.trim().toLowerCase();
  const allowed = [
    IMAGE_MODEL.id,
    IMAGE_MODEL.label,
    settings.imageModelId || DEFAULT_IMAGE_UPSTREAM_MODEL
  ].map((item) => item.toLowerCase());

  return allowed.includes(normalized);
}

function imageDataItemFromUrl(imageUrl: string, responseFormat: "b64_json" | "url") {
  if (responseFormat === "b64_json") {
    const match = imageUrl.match(/^data:image\/[^;]+;base64,(.+)$/);

    if (match?.[1]) {
      return { b64_json: match[1] };
    }
  }

  return { url: imageUrl };
}

function mockImageUrl(prompt: string, size = DEFAULT_IMAGE_SIZE) {
  const imageSize = normalizeImageSize(size);
  const { width, height } = imageSizeDimensions(imageSize);
  const minSide = Math.min(width, height);
  const centerX = Math.round(width / 2);
  const promptY = Math.round(height * 0.52);
  const labelY = promptY + Math.round(minSide * 0.08);
  const titleFont = Math.max(24, Math.round(minSide * 0.053));
  const labelFont = Math.max(18, Math.round(minSide * 0.033));
  const escapedPrompt = prompt
    .slice(0, 18)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#0f766e"/><stop offset="0.55" stop-color="#2563eb"/><stop offset="1" stop-color="#f59e0b"/></linearGradient></defs><rect width="${width}" height="${height}" fill="url(#g)"/><circle cx="${Math.round(width * 0.74)}" cy="${Math.round(height * 0.25)}" r="${Math.round(minSide * 0.14)}" fill="#ffffff" opacity="0.18"/><path d="M${Math.round(width * 0.16)} ${Math.round(height * 0.7)}C${Math.round(width * 0.25)} ${Math.round(height * 0.53)} ${Math.round(width * 0.36)} ${Math.round(height * 0.44)} ${Math.round(width * 0.49)} ${Math.round(height * 0.44)}C${Math.round(width * 0.61)} ${Math.round(height * 0.44)} ${Math.round(width * 0.71)} ${Math.round(height * 0.52)} ${Math.round(width * 0.84)} ${Math.round(height * 0.7)}H${Math.round(width * 0.16)}Z" fill="#ffffff" opacity="0.28"/><text x="${centerX}" y="${promptY}" font-size="${titleFont}" text-anchor="middle" fill="white" font-family="Arial, sans-serif">${escapedPrompt}</text><text x="${centerX}" y="${labelY}" font-size="${labelFont}" text-anchor="middle" fill="white" opacity="0.86" font-family="Arial, sans-serif">${IMAGE_MODEL.label} mock ${imageSize}</text></svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function cleanUpstreamErrorText(text: string) {
  const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const heading = text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const candidate = title || heading || text;

  return candidate
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function friendlyHttpHint(status: number) {
  if (status === 400) {
    return "请求参数不被上游支持";
  }

  if (status === 401 || status === 403) {
    return "上游 API Key 无效或无权限";
  }

  if (status === 404) {
    return "接口路径或模型不存在";
  }

  if (status === 429) {
    return "上游额度或频率限制";
  }

  if (status >= 500) {
    return "上游服务错误";
  }

  return "";
}

function messageFromUpstreamBody(text: string) {
  if (!text.trim()) {
    return "";
  }

  try {
    const payload = JSON.parse(text) as {
      details?: { message?: string } | string;
      error?: { message?: string; type?: string; code?: string } | string;
      message?: string;
    };
    const errorField = payload.error;
    const detailField = payload.details;

    return (
      (typeof errorField === "string" ? errorField : errorField?.message) ||
      (typeof detailField === "string" ? detailField : detailField?.message) ||
      payload.message ||
      ""
    );
  } catch {
    return cleanUpstreamErrorText(text);
  }
}

async function upstreamFailureFromResponse(response: Response): Promise<UpstreamFailure> {
  const text = (await response.text().catch(() => "")).slice(0, 4000);
  const hint = friendlyHttpHint(response.status);
  const prefix = `上游 API 错误（HTTP ${response.status}${hint ? `，${hint}` : ""}）`;
  const message = messageFromUpstreamBody(text);

  return {
    message: message ? `${prefix}：${cleanUpstreamErrorText(message).slice(0, 500)}` : `${prefix}。`,
    status: response.status,
    upstreamBody: text
  };
}

function shouldRetryUpstreamFailure(failure: UpstreamFailure) {
  return /instructions|store|reasoning|input_file|\bfile_data\b|\bfile_id\b|\bfile_url\b|tool_choice|parallel_tool_calls|metadata|max_output_tokens|unsupported|unrecognized|unknown|unexpected|not\s+(?:permitted|supported|allowed)|invalid[\s_]*(?:param|argument|field|request|file)|额外|不支持|无效参数/i.test(
    failure.message
  );
}

function withoutKeys(body: Record<string, unknown>, keys: string[]) {
  const next = { ...body };

  keys.forEach((key) => {
    delete next[key];
  });

  return next;
}

function uniqueBodyCandidates(candidates: Record<string, unknown>[]) {
  const seen = new Set<string>();

  return candidates.filter((candidate) => {
    const key = JSON.stringify(candidate);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function responseBodyFallbackCandidates(body: Record<string, unknown>) {
  const stripped = withoutKeys(body, [
    "metadata",
    "parallel_tool_calls",
    "reasoning",
    "store",
    "tool_choice",
    "user"
  ]);

  return uniqueBodyCandidates([body, stripped]);
}

function chatCompletionBodyFallbackCandidates(body: Record<string, unknown>) {
  const stripped = withoutKeys(body, ["metadata", "reasoning", "store", "user"]);
  const withoutParallel = withoutKeys(stripped, ["parallel_tool_calls"]);
  const withoutTools = withoutKeys(withoutParallel, ["tool_choice", "tools"]);

  return uniqueBodyCandidates([body, stripped, withoutParallel, withoutTools]);
}

async function fetchUpstreamResponses({
  body,
  incomingHeaders,
  settings,
  signal
}: {
  body: Record<string, unknown>;
  incomingHeaders: Headers;
  settings: AiRuntimeSettings;
  signal: AbortSignal;
}): Promise<UpstreamResponsesResult> {
  const url = `${settings.apiBaseUrl}/responses`;
  let lastFailure: UpstreamFailure | null = null;

  for (const candidate of responseBodyFallbackCandidates(body)) {
    let response: Response;

    try {
      response = await fetch(url, {
        method: "POST",
        headers: upstreamHeaders(settings, incomingHeaders),
        body: JSON.stringify(candidate),
        signal
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }

      lastFailure = {
        message: `无法连接上游 API：${error instanceof Error ? error.message : String(error)}`,
        status: 502
      };
      break;
    }

    if (response.ok && response.body) {
      return { response: response as ResponseWithBody };
    }

    const failure = await upstreamFailureFromResponse(response);
    lastFailure = failure;

    if (!shouldRetryUpstreamFailure(failure)) {
      break;
    }
  }

  return {
    failure: lastFailure || {
      message: "上游 API 调用失败。",
      status: 502
    }
  };
}

async function fetchUpstreamChatCompletions({
  body,
  incomingHeaders,
  settings,
  signal
}: {
  body: Record<string, unknown>;
  incomingHeaders: Headers;
  settings: AiRuntimeSettings;
  signal: AbortSignal;
}): Promise<UpstreamResponsesResult> {
  const url = `${settings.apiBaseUrl}/chat/completions`;
  let lastFailure: UpstreamFailure | null = null;

  for (const candidate of chatCompletionBodyFallbackCandidates(body)) {
    let response: Response;

    try {
      response = await fetch(url, {
        method: "POST",
        headers: upstreamHeaders(settings, incomingHeaders),
        body: JSON.stringify(candidate),
        signal
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }

      lastFailure = {
        message: `无法连接上游 API：${error instanceof Error ? error.message : String(error)}`,
        status: 502
      };
      break;
    }

    if (response.ok && response.body) {
      return { response: response as ResponseWithBody };
    }

    const failure = await upstreamFailureFromResponse(response);
    lastFailure = failure;

    if (!shouldRetryUpstreamFailure(failure)) {
      break;
    }
  }

  return {
    failure: lastFailure || {
      message: "上游 Chat Completions 调用失败。",
      status: 502
    }
  };
}

function upstreamJsonError(failure: UpstreamFailure, model: ChatModelConfig) {
  return jsonError(failure.message, failure.status || 502, {
    type: "upstream_error",
    upstreamModel: model.upstreamId || model.id
  });
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

function normalizeResponsesBodyForSub2Api(body: Record<string, unknown>) {
  const input = Array.isArray(body.input) ? body.input : null;
  const next = withoutKeys(body, ["user"]);

  if (!input) {
    return next;
  }

  const extractedInstructions: string[] = [];
  const normalizedInput = input.filter((item) => {
    const object = jsonObject(item);
    const role = typeof object?.role === "string" ? object.role.toLowerCase() : "";

    if (role !== "system" && role !== "developer") {
      return true;
    }

    const text = textFromMessageContent(object?.content).trim();

    if (text) {
      extractedInstructions.push(text);
    }

    return false;
  });

  if (extractedInstructions.length === 0) {
    return next;
  }

  const currentInstructions = typeof next.instructions === "string" ? next.instructions.trim() : "";

  return {
    ...next,
    input: normalizedInput,
    instructions: [...extractedInstructions, currentInstructions].filter(Boolean).join("\n\n")
  };
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
  // Normalize caller-provided system/developer input before adding the gateway
  // identity layer. This keeps the gateway identity prompt first and the
  // caller's workspace/tool instructions last, so newer models do not treat
  // the lightweight identity correction as an environment capability override.
  const normalizedBody = normalizeResponsesBodyForSub2Api({
    ...body,
    model: model.upstreamId || model.id
  });
  const instructions = gatewayInstructions({
    body: normalizedBody,
    model,
    settings
  });

  return {
    ...normalizedBody,
    ...(instructions ? { instructions } : {})
  };
}

function chatCompletionRequestToUpstreamBody({
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

  const identityPrompt = resolveApiIdentityPrompt({
    mode: settings.systemPromptMode,
    modelLabel: model.label
  });
  const callerInstructions = typeof body.instructions === "string" ? body.instructions.trim() : "";
  const injectedMessages = [identityPrompt, callerInstructions]
    .filter(Boolean)
    .map((content) => ({
      role: "system",
      content
    }));
  const upstreamMessages = messages.map((message) => {
    const object = jsonObject(message);

    if (!object) {
      return message;
    }

    return object.role === "developer" ? { ...object, role: "system" } : object;
  });
  const upstreamBody: Record<string, unknown> = {
    ...body,
    messages: [...injectedMessages, ...upstreamMessages],
    model: model.upstreamId || model.id
  };

  delete upstreamBody.instructions;

  return upstreamBody;
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

type UsageAuditMetadata = {
  billingMode?: string;
  durationMs?: number | null;
  endpoint?: string;
  firstTokenLatencyMs?: number | null;
  reasoningEffort?: string;
  requestKind?: string;
  userAgent?: string;
};

function usageRequestKind(body: Record<string, unknown>) {
  return body.stream === true ? "stream" : "sync";
}

function usageReasoningEffort(body: Record<string, unknown>) {
  const reasoning = jsonObject(body.reasoning);
  const effort =
    (typeof reasoning?.effort === "string" ? reasoning.effort : "") ||
    (typeof body.reasoning_effort === "string" ? body.reasoning_effort : "");

  return effort.slice(0, 32);
}

function usageUserAgent(request: NextRequest) {
  return (request.headers.get("user-agent") || "").slice(0, 240);
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

function serializeImageModel(settings: AiRuntimeSettings) {
  return {
    id: IMAGE_MODEL.id,
    object: "model",
    created: 0,
    owned_by: "team-ai-gateway",
    label: IMAGE_MODEL.label,
    upstream_id: settings.imageModelId || DEFAULT_IMAGE_UPSTREAM_MODEL,
    mode: "image",
    endpoint: "/v1/images/generations",
    fixed_cost_cents: IMAGE_MODEL.fixedCostCents,
    prompt_cents_per_million_tokens: IMAGE_MODEL.promptCentsPerMillionTokens
  };
}

async function recordUserApiUsage({
  apiKeyPrefix,
  audit,
  completionTokensEstimate,
  model,
  promptTokensEstimate,
  upstreamUsage,
  userId
}: {
  apiKeyPrefix?: string | null;
  audit?: UsageAuditMetadata;
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

  await createUsageRecordWithQuotaDebit({
    data: {
      userId,
      model: model.id,
      mode: "CHAT",
      promptTokens: tokenUsage.promptTokens,
      completionTokens: tokenUsage.completionTokens,
      totalTokens: tokenUsage.totalTokens,
      cachedPromptTokens: tokenUsage.cachedPromptTokens,
      reasoningTokens: tokenUsage.reasoningTokens,
      usageSource: apiKeyPrefix
        ? `user_api:${apiKeyPrefix}:${tokenUsage.usageSource}`
        : `user_api:${tokenUsage.usageSource}`,
      upstreamUsageJson: tokenUsage.upstreamUsageJson,
      estimatedCostCents: tokenUsage.estimatedCostCents,
      endpoint: audit?.endpoint ?? "",
      requestKind: audit?.requestKind ?? "",
      billingMode: audit?.billingMode ?? "按量",
      reasoningEffort: audit?.reasoningEffort ?? "",
      firstTokenLatencyMs: audit?.firstTokenLatencyMs ?? null,
      durationMs: audit?.durationMs ?? null,
      userAgent: audit?.userAgent ?? ""
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
  const requestStartedAt = Date.now();
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

  const upstreamSettings = resolveUpstreamSettingsForModel(settings, model);

  const auditBase: UsageAuditMetadata = {
    billingMode: "按量",
    endpoint: "/v1/responses",
    reasoningEffort: usageReasoningEffort(body),
    requestKind: usageRequestKind(body),
    userAgent: usageUserAgent(request)
  };
  const upstreamBody = upstreamRequestBody({
    body,
    model,
    settings: upstreamSettings
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
      apiKeyPrefix: authenticated.apiKey.keyPrefix,
      audit: {
        ...auditBase,
        durationMs: Date.now() - requestStartedAt,
        firstTokenLatencyMs: 0
      },
      completionTokensEstimate: numberFromUsage(payload.usage.output_tokens),
      model,
      promptTokensEstimate,
      upstreamUsage: payload.usage,
      userId: authenticated.user.id
    });

    return Response.json(payload);
  }

  try {
    assertUpstreamConfigured(upstreamSettings, model.label);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "上游 API 未配置。", 500);
  }

  const upstream = await fetchUpstreamResponses({
    body: upstreamBody,
    incomingHeaders: request.headers,
    settings: upstreamSettings,
    signal: request.signal
  });

  if ("failure" in upstream) {
    return upstreamJsonError(upstream.failure, model);
  }

  const { response } = upstream;

  if (body.stream === true) {
    let buffer = "";
    let firstTokenLatencyMs: number | null = null;
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
                  const text = outputTextFromPayload(payload);

                  if (text && firstTokenLatencyMs === null) {
                    firstTokenLatencyMs = Date.now() - requestStartedAt;
                  }

                  upstreamUsage = parseUsage(payload) ?? upstreamUsage;
                  outputText += text;
                } catch {
                  // Ignore non-JSON SSE data from custom providers.
                }
              }

              boundary = buffer.indexOf("\n\n");
            }
          }

          await recordUserApiUsage({
            apiKeyPrefix: authenticated.apiKey.keyPrefix,
            audit: {
              ...auditBase,
              durationMs: Date.now() - requestStartedAt,
              firstTokenLatencyMs
            },
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
    apiKeyPrefix: authenticated.apiKey.keyPrefix,
    audit: {
      ...auditBase,
      durationMs: Date.now() - requestStartedAt
    },
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
  const requestStartedAt = Date.now();
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

  const upstreamSettings = resolveUpstreamSettingsForModel(settings, model);

  const auditBase: UsageAuditMetadata = {
    billingMode: "按量",
    endpoint: "/v1/chat/completions",
    reasoningEffort: usageReasoningEffort(body),
    requestKind: usageRequestKind(body),
    userAgent: usageUserAgent(request)
  };
  const upstreamBody = chatCompletionRequestToUpstreamBody({
    body,
    model,
    settings: upstreamSettings
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
      apiKeyPrefix: authenticated.apiKey.keyPrefix,
      audit: {
        ...auditBase,
        durationMs: Date.now() - requestStartedAt,
        firstTokenLatencyMs: 0
      },
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
    assertUpstreamConfigured(upstreamSettings, model.label);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "上游 API 未配置。", 500);
  }

  const upstream = await fetchUpstreamChatCompletions({
    body: upstreamBody,
    incomingHeaders: request.headers,
    settings: upstreamSettings,
    signal: request.signal
  });

  if ("failure" in upstream) {
    return upstreamJsonError(upstream.failure, model);
  }

  const { response } = upstream;

  if (body.stream === true) {
    let buffer = "";
    let firstTokenLatencyMs: number | null = null;
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
                  const text = outputTextFromPayload(payload);

                  if (text && firstTokenLatencyMs === null) {
                    firstTokenLatencyMs = Date.now() - requestStartedAt;
                  }

                  upstreamUsage = parseUsage(payload) ?? upstreamUsage;
                  outputText += text;
                } catch {
                  // Ignore non-JSON SSE data from custom providers.
                }
              }

              boundary = buffer.indexOf("\n\n");
            }
          }

          await recordUserApiUsage({
            apiKeyPrefix: authenticated.apiKey.keyPrefix,
            audit: {
              ...auditBase,
              durationMs: Date.now() - requestStartedAt,
              firstTokenLatencyMs
            },
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
    apiKeyPrefix: authenticated.apiKey.keyPrefix,
    audit: {
      ...auditBase,
      durationMs: Date.now() - requestStartedAt
    },
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

export async function handleUserImageGenerationsRequest(request: NextRequest) {
  const requestStartedAt = Date.now();
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

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";

  if (!prompt) {
    return jsonError("图片生成请求必须包含 prompt。", 400);
  }

  const imageCount = normalizeImageCount(body.n);

  if (!imageCount) {
    return jsonError("n 必须是 1 到 4 之间的整数。", 400);
  }

  const settings = await getAiRuntimeSettings();

  if (!isAllowedImageModel(body.model, settings)) {
    return jsonError("图片模型不可用或未启用。请使用 image2。", 400);
  }

  const size = normalizeImageSize(body.size);
  const responseFormat = normalizeImageResponseFormat(body.response_format);
  const promptTokens = promptEstimateFromImagePrompt(prompt);
  const estimatedCostCents = estimateImageCostCents(promptTokens) * imageCount;

  try {
    await assertQuotaAvailable(authenticated.user.id, estimatedCostCents);
  } catch (error) {
    if (error instanceof QuotaError) {
      return jsonError(error.message, error.status, { usage: error.summary });
    }

    throw error;
  }

  let imageUrls: string[];

  try {
    if (settings.mockResponses) {
      imageUrls = Array.from({ length: imageCount }, () => mockImageUrl(prompt, size));
    } else {
      try {
        assertUpstreamConfigured(settings);
      } catch (error) {
        return jsonError(error instanceof Error ? error.message : "上游 API 未配置。", 500);
      }

      imageUrls = await Promise.all(
        Array.from({ length: imageCount }, () => generateImage(prompt, size))
      );
    }
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "上游生图失败。", 502);
  }

  const finishedAt = Date.now();
  await createUsageRecordWithQuotaDebit({
    data: {
      userId: authenticated.user.id,
      model: IMAGE_MODEL.id,
      mode: "IMAGE",
      promptTokens: promptTokens * imageCount,
      totalTokens: promptTokens * imageCount,
      estimatedCostCents,
      endpoint: "/v1/images/generations",
      requestKind: "sync",
      billingMode: "按量",
      usageSource: `user_api:${authenticated.apiKey.keyPrefix}:estimated`,
      durationMs: finishedAt - requestStartedAt,
      userAgent: usageUserAgent(request)
    }
  });

  return Response.json({
    created: Math.floor(finishedAt / 1000),
    data: imageUrls.map((imageUrl) => imageDataItemFromUrl(imageUrl, responseFormat))
  });
}

export async function handleUserModelsRequest(request: NextRequest) {
  const authenticated = await authenticateUserApiKey(request.headers.get("authorization"));

  if (!authenticated) {
    return jsonError("无效的 API Key，或当前账号不是 VIP 用户组。", 401);
  }

  const settings = await getAiRuntimeSettings();

  return Response.json({
    object: "list",
    data: [
      ...getEnabledApiModels(settings.chatModels).map(serializeModel),
      serializeImageModel(settings)
    ]
  });
}
