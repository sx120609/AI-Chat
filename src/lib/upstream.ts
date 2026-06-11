import {
  buildChatModelCatalog,
  DEFAULT_IMAGE_UPSTREAM_MODEL,
  DEFAULT_LONG_CONTEXT_THRESHOLD_TOKENS,
  DEFAULT_REASONING_EFFORT,
  DEFAULT_REASONING_PARAM_MODE,
  getChatModel,
  IMAGE_MODEL,
  normalizeLongContextThresholdTokens,
  normalizeReasoningEffort,
  normalizeReasoningParamMode,
  uniqueModelIds,
  type ChatModelConfig,
  type ReasoningEffort,
  type ReasoningParamMode
} from "@/lib/models";
import {
  normalizeSystemPromptMode,
  parseModelSystemPrompts,
  type SystemPromptMode
} from "@/lib/system-prompt";
import { cacheGetJson, cacheSetJson } from "@/lib/cache";
import { prisma } from "@/lib/prisma";
import type { ChatMessageContent } from "@/lib/tokens";

export type UpstreamChatMessage = {
  role: "system" | "user" | "assistant";
  content: ChatMessageContent;
};

export type UpstreamUsage = {
  cached_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  prompt_tokens_details?: {
    audio_tokens?: number;
    cached_tokens?: number;
  };
  completion_tokens_details?: {
    accepted_prediction_tokens?: number;
    audio_tokens?: number;
    reasoning_tokens?: number;
    rejected_prediction_tokens?: number;
  };
  input_token_details?: {
    cached_tokens?: number;
  };
  output_token_details?: {
    reasoning_tokens?: number;
  };
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cost?: number | string;
  total_cost?: number | string;
  cost_usd?: number | string;
};

export type AiRuntimeSettings = {
  apiBaseUrl: string;
  apiKey: string;
  orgId: string;
  mockResponses: boolean;
  chatModels: ChatModelConfig[];
  imageModelId: string;
  defaultReasoningEffort: ReasoningEffort;
  reasoningParamMode: ReasoningParamMode;
  longContextThresholdTokens: number;
  systemPromptMode: SystemPromptMode;
  customSystemPrompt: string;
  modelSystemPrompts: Record<string, string>;
  codeInterpreterEnabled: boolean;
  codeInterpreterSandbox: string;
  codeInterpreterAllowPackageInstall: boolean;
  codeInterpreterPipIndexUrl: string;
  webSearchEnabled: boolean;
  webSearchProvider: string;
  webSearchMaxResults: number;
  googleSearchApiKey: string;
  googleSearchCx: string;
};

const CHAT_HEADERS_TIMEOUT_MS = 60_000;
const MODELS_TIMEOUT_MS = 20_000;
const IMAGE_TIMEOUT_MS = 300_000;
export const AI_RUNTIME_SETTINGS_CACHE_KEY = "ai-runtime-settings:v1";
const AI_RUNTIME_SETTINGS_CACHE_TTL_SECONDS = 30;

function normalizeWebSearchProvider(provider: string | null | undefined) {
  return provider === "bing" || provider === "google" ? provider : "duckduckgo";
}

export async function getAiRuntimeSettings(): Promise<AiRuntimeSettings> {
  const cached = await cacheGetJson<AiRuntimeSettings>(AI_RUNTIME_SETTINGS_CACHE_KEY);

  if (cached) {
    return cached;
  }

  const settings = await prisma.aiSettings.findUnique({
    where: { id: "default" }
  });

  const runtimeSettings: AiRuntimeSettings = {
    apiBaseUrl: (
      settings?.apiBaseUrl ||
      process.env.AI_API_BASE_URL ||
      "https://api.openai.com/v1"
    ).replace(/\/+$/, ""),
    apiKey: settings?.apiKey || process.env.AI_API_KEY || "",
    orgId: settings?.orgId || process.env.AI_ORG_ID || "",
    mockResponses: settings ? settings.mockResponses : process.env.AI_MOCK_RESPONSES === "true",
    chatModels: buildChatModelCatalog(settings ?? undefined),
    imageModelId: settings?.imageModelId || DEFAULT_IMAGE_UPSTREAM_MODEL,
    defaultReasoningEffort: normalizeReasoningEffort(
      settings?.defaultReasoningEffort || DEFAULT_REASONING_EFFORT
    ),
    reasoningParamMode: normalizeReasoningParamMode(
      settings?.reasoningParamMode || DEFAULT_REASONING_PARAM_MODE
    ),
    longContextThresholdTokens: normalizeLongContextThresholdTokens(
      settings?.longContextThresholdTokens || DEFAULT_LONG_CONTEXT_THRESHOLD_TOKENS
    ),
    systemPromptMode: normalizeSystemPromptMode(settings?.systemPromptMode),
    customSystemPrompt: settings?.customSystemPrompt || "",
    modelSystemPrompts: parseModelSystemPrompts(settings?.modelSystemPromptsJson),
    codeInterpreterEnabled:
      settings?.codeInterpreterEnabled ?? process.env.CODE_INTERPRETER_ENABLED === "true",
    codeInterpreterSandbox:
      settings?.codeInterpreterSandbox || process.env.CODE_INTERPRETER_SANDBOX || "docker",
    codeInterpreterAllowPackageInstall:
      settings?.codeInterpreterAllowPackageInstall ??
      process.env.CODE_INTERPRETER_ALLOW_PACKAGE_INSTALL === "true",
    codeInterpreterPipIndexUrl:
      settings?.codeInterpreterPipIndexUrl ||
      process.env.CODE_INTERPRETER_PIP_INDEX_URL ||
      "https://pypi.org/simple",
    webSearchEnabled: settings?.webSearchEnabled ?? process.env.WEB_SEARCH_ENABLED === "true",
    webSearchProvider: normalizeWebSearchProvider(
      settings?.webSearchProvider || process.env.WEB_SEARCH_PROVIDER
    ),
    webSearchMaxResults: Math.min(
      8,
      Math.max(1, settings?.webSearchMaxResults || Number(process.env.WEB_SEARCH_MAX_RESULTS) || 5)
    ),
    googleSearchApiKey: settings?.googleSearchApiKey || process.env.GOOGLE_SEARCH_API_KEY || "",
    googleSearchCx:
      settings?.googleSearchCx ||
      process.env.GOOGLE_SEARCH_CX ||
      process.env.GOOGLE_SEARCH_ENGINE_ID ||
      ""
  };

  await cacheSetJson(
    AI_RUNTIME_SETTINGS_CACHE_KEY,
    runtimeSettings,
    AI_RUNTIME_SETTINGS_CACHE_TTL_SECONDS
  );

  return runtimeSettings;
}

const streamEncoder = new TextEncoder();

function openAiSseFromPayload(payload: unknown) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(streamEncoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      controller.enqueue(streamEncoder.encode("data: [DONE]\n\n"));
      controller.close();
    }
  });
}

function openAiSseFromText(text: string) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(streamEncoder.encode(text));

      if (!text.includes("[DONE]")) {
        controller.enqueue(streamEncoder.encode("\n\ndata: [DONE]\n\n"));
      }

      controller.close();
    }
  });
}

function normalizeNonStreamingPayload(payload: unknown) {
  const json = payload as {
    choices?: unknown;
    content?: unknown;
    output_text?: unknown;
    response?: unknown;
    text?: unknown;
    usage?: unknown;
  };

  if (Array.isArray(json.choices)) {
    return payload;
  }

  const content =
    typeof json.output_text === "string"
      ? json.output_text
      : typeof json.content === "string"
        ? json.content
        : typeof json.response === "string"
          ? json.response
          : typeof json.text === "string"
            ? json.text
            : "";

  return {
    choices: [{ message: { content } }],
    usage: json.usage
  };
}

function textFromChatCompletionPayload(payload: unknown) {
  const json = normalizeNonStreamingPayload(payload) as {
    choices?: Array<{
      message?: { content?: unknown };
      text?: unknown;
    }>;
  };

  return (
    json.choices
      ?.map((choice) =>
        typeof choice.message?.content === "string"
          ? choice.message.content
          : typeof choice.text === "string"
            ? choice.text
            : ""
      )
      .join("")
      .trim() ?? ""
  );
}

async function openAiCompatibleBody(response: Response) {
  if (!response.body) {
    throw new Error("上游 API 没有返回响应体。");
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("text/event-stream")) {
    return response.body;
  }

  const text = await response.text();

  if (!text.trim()) {
    return openAiSseFromPayload({ choices: [{ message: { content: "" } }] });
  }

  if (/^\s*(event:|data:)/m.test(text)) {
    return openAiSseFromText(text);
  }

  try {
    const payload = JSON.parse(text) as unknown;
    const errorField = (payload as { error?: { message?: string } | string }).error;

    if (errorField) {
      throw new Error(
        typeof errorField === "string"
          ? `上游 API 错误：${errorField}`
          : `上游 API 错误：${errorField.message || "请求失败。"}`
      );
    }

    return openAiSseFromPayload(normalizeNonStreamingPayload(payload));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("上游 API 错误")) {
      throw error;
    }

    return openAiSseFromPayload({ choices: [{ message: { content: text } }] });
  }
}

export function assertUpstreamConfigured(settings: AiRuntimeSettings) {
  if (!settings.mockResponses && !settings.apiKey) {
    throw new Error("请先在管理后台设置 API Key，或开启 Mock 模式。");
  }
}

function upstreamHeaders(settings: AiRuntimeSettings) {
  return {
    ...upstreamAuthHeaders(settings),
    "content-type": "application/json"
  };
}

function upstreamAuthHeaders(settings: AiRuntimeSettings) {
  const headers: Record<string, string> = {
    authorization: `Bearer ${settings.apiKey}`
  };

  if (settings.orgId) {
    headers["OpenAI-Organization"] = settings.orgId;
  }

  return headers;
}

// 超时仅作用于"等待响应头"阶段：fetch resolve 后清除定时器，不影响后续流式读取。
async function fetchWithHeadersTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const parentSignal = init.signal;
  let timedOut = false;
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw new Error(
        `上游 API 在 ${Math.round(timeoutMs / 1000)} 秒内没有响应，请检查 API 地址与网络连通性。`
      );
    }

    if (controller.signal.aborted || parentSignal?.aborted) {
      throw new Error("请求已停止。");
    }

    throw new Error(
      `无法连接上游 API：${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

function friendlyHttpHint(status: number) {
  if (status === 401) {
    return "API Key 无效或已过期";
  }

  if (status === 403) {
    return "没有权限访问（检查 Key 的分组/模型权限）";
  }

  if (status === 404) {
    return "接口路径不存在（API 地址通常需要以 /v1 结尾，或模型 ID 不存在）";
  }

  if (status === 429) {
    return "上游限流或额度不足";
  }

  if (status >= 500) {
    return "上游服务暂时不可用";
  }

  return "";
}

async function upstreamErrorMessage(response: Response) {
  const text = (await response.text().catch(() => "")).slice(0, 2000);
  const hint = friendlyHttpHint(response.status);
  const prefix = `上游 API 错误（HTTP ${response.status}${hint ? `，${hint}` : ""}）`;

  if (!text) {
    return `${prefix}。`;
  }

  try {
    const payload = JSON.parse(text) as {
      error?: { message?: string; type?: string; code?: string } | string;
      message?: string;
    };
    const errorField = payload.error;
    const message =
      typeof errorField === "string" ? errorField : errorField?.message || payload.message || "";

    if (message) {
      return `${prefix}：${message}`;
    }
  } catch {
    return `${prefix}：${text.slice(0, 300)}`;
  }

  return `${prefix}：${text.slice(0, 300)}`;
}

// Sub2API / One API 等网关的旧版本可能不认识 stream_options 或 reasoning 参数，
// 遇到这类 400 报错时逐步降级，尽量保留 include_usage。
function looksLikeUnsupportedParamError(message: string) {
  return /stream_options|reasoning|unknown|unrecognized|unexpected|not\s+(?:permitted|supported|allowed)|invalid[\s_]*(?:param|argument|field|request)|额外|不支持|无效参数/i.test(
    message
  );
}

export async function createChatCompletionStream(
  model: string,
  messages: UpstreamChatMessage[],
  settings: AiRuntimeSettings,
  options?: {
    reasoningEffort?: ReasoningEffort;
    signal?: AbortSignal;
  }
) {
  assertUpstreamConfigured(settings);
  const selectedModel = getChatModel(model, settings.chatModels);
  const url = `${settings.apiBaseUrl}/chat/completions`;
  const baseBody: Record<string, unknown> = {
    model: selectedModel.upstreamId,
    messages,
    stream: true
  };
  const fullBody: Record<string, unknown> = {
    ...baseBody,
    // 请求上游在流末尾返回 usage，确保 token 统计准确（OpenAI 兼容网关基本都支持）
    stream_options: { include_usage: true }
  };
  const reasoningEffort = normalizeReasoningEffort(
    options?.reasoningEffort || settings.defaultReasoningEffort
  );

  if (selectedModel.supportsReasoning && settings.reasoningParamMode !== "disabled") {
    if (settings.reasoningParamMode === "responses") {
      fullBody.reasoning = { effort: reasoningEffort };
    } else {
      fullBody.reasoning_effort = reasoningEffort;
    }
  }

  const requestInit = (body: Record<string, unknown>): RequestInit => ({
    method: "POST",
    headers: upstreamHeaders(settings),
    body: JSON.stringify(body),
    signal: options?.signal
  });

  const bodyCandidates = [fullBody];

  if (fullBody.reasoning || fullBody.reasoning_effort) {
    bodyCandidates.push({
      ...baseBody,
      stream_options: { include_usage: true }
    });
  }

  bodyCandidates.push(baseBody);

  let lastUnsupportedParamError = "";

  for (const candidate of bodyCandidates) {
    const response = await fetchWithHeadersTimeout(
      url,
      requestInit(candidate),
      CHAT_HEADERS_TIMEOUT_MS
    );

    if (response.ok && response.body) {
      return openAiCompatibleBody(response);
    }

    const message = await upstreamErrorMessage(response);

    if (!looksLikeUnsupportedParamError(message)) {
      throw new Error(message);
    }

    lastUnsupportedParamError = message;
  }

  throw new Error(lastUnsupportedParamError || "上游 API 不支持当前请求参数。");
}

export async function createChatCompletionText(
  model: string,
  messages: UpstreamChatMessage[],
  settings: AiRuntimeSettings,
  options?: { signal?: AbortSignal }
) {
  assertUpstreamConfigured(settings);
  const selectedModel = getChatModel(model, settings.chatModels);
  const url = `${settings.apiBaseUrl}/chat/completions`;
  const body = {
    model: selectedModel.upstreamId,
    messages,
    stream: false
  };
  const response = await fetchWithHeadersTimeout(
    url,
    {
      method: "POST",
      headers: upstreamHeaders(settings),
      body: JSON.stringify(body),
      signal: options?.signal
    },
    CHAT_HEADERS_TIMEOUT_MS
  );

  if (!response.ok) {
    throw new Error(await upstreamErrorMessage(response));
  }

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!payload) {
    return "";
  }

  return textFromChatCompletionPayload(payload);
}

function collectModelIds(payload: unknown) {
  const json = payload as {
    data?: unknown;
    models?: unknown;
  };
  const list = Array.isArray(json?.data)
    ? json.data
    : Array.isArray(json?.models)
      ? json.models
      : Array.isArray(payload)
        ? payload
        : [];

  return (list as Array<unknown>)
    .map((item) => {
      if (typeof item === "string") {
        return item.trim();
      }

      if (item && typeof item === "object" && "id" in item) {
        const id = (item as { id?: unknown }).id;
        return typeof id === "string" ? id.trim() : "";
      }

      return "";
    })
    .filter(Boolean);
}

export async function fetchUpstreamModelIds(settings: AiRuntimeSettings) {
  assertUpstreamConfigured(settings);

  if (settings.mockResponses) {
    return settings.chatModels.map((model) => model.upstreamId);
  }

  const response = await fetchWithHeadersTimeout(
    `${settings.apiBaseUrl}/models`,
    {
      method: "GET",
      headers: upstreamHeaders(settings)
    },
    MODELS_TIMEOUT_MS
  );

  if (!response.ok) {
    throw new Error(await upstreamErrorMessage(response));
  }

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!payload) {
    throw new Error("上游 /models 返回的不是有效 JSON。");
  }

  const ids = collectModelIds(payload);

  return uniqueModelIds(ids).sort((left, right) => left.localeCompare(right));
}

type SourceImage = {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
};

async function imageUrlFromResponse(response: Response) {
  const payload = (await response.json()) as {
    data?: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>;
  };
  const first = payload.data?.[0];

  if (!first?.url && !first?.b64_json) {
    throw new Error("上游响应中没有图片数据。");
  }

  return first.url || `data:image/png;base64,${first.b64_json}`;
}

async function editImage(prompt: string, size: string, settings: AiRuntimeSettings, images: SourceImage[]) {
  const formData = new FormData();

  formData.set("model", settings.imageModelId || IMAGE_MODEL.id);
  formData.set("prompt", prompt);
  formData.set("size", size);

  for (const [index, image] of images.entries()) {
    formData.append(
      index === 0 ? "image" : "image[]",
      new Blob([new Uint8Array(image.buffer)], { type: image.mimeType }),
      image.originalName
    );
  }

  const response = await fetchWithHeadersTimeout(
    `${settings.apiBaseUrl}/images/edits`,
    {
      method: "POST",
      headers: upstreamAuthHeaders(settings),
      body: formData
    },
    IMAGE_TIMEOUT_MS
  );

  if (!response.ok) {
    const message = await upstreamErrorMessage(response);
    throw new Error(`/images/edits 图片编辑失败：${message}`);
  }

  return imageUrlFromResponse(response);
}

export async function generateImage(
  prompt: string,
  size = "1024x1024",
  options?: { sourceImages?: SourceImage[] }
) {
  const settings = await getAiRuntimeSettings();
  assertUpstreamConfigured(settings);

  if (settings.mockResponses) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#0f766e"/><stop offset="0.55" stop-color="#2563eb"/><stop offset="1" stop-color="#f59e0b"/></linearGradient></defs><rect width="1024" height="1024" fill="url(#g)"/><circle cx="760" cy="260" r="140" fill="#ffffff" opacity="0.18"/><path d="M168 716c95-178 205-268 330-268 116 0 219 70 358 268H168z" fill="#ffffff" opacity="0.28"/><text x="512" y="530" font-size="54" text-anchor="middle" fill="white" font-family="Arial, sans-serif">${escapeSvg(prompt.slice(0, 18))}</text><text x="512" y="610" font-size="34" text-anchor="middle" fill="white" opacity="0.86" font-family="Arial, sans-serif">${IMAGE_MODEL.label} mock</text></svg>`;

    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }

  if (options?.sourceImages?.length) {
    return editImage(prompt, size, settings, options.sourceImages);
  }

  const url = `${settings.apiBaseUrl}/images/generations`;
  const baseBody = {
    model: settings.imageModelId || IMAGE_MODEL.id,
    prompt,
    n: 1,
    size
  };
  const requestInit = (body: Record<string, unknown>): RequestInit => ({
    method: "POST",
    headers: upstreamHeaders(settings),
    body: JSON.stringify(body)
  });
  let response = await fetchWithHeadersTimeout(
    url,
    requestInit({
      ...baseBody,
      response_format: "b64_json"
    }),
    IMAGE_TIMEOUT_MS
  );

  if (!response.ok) {
    const message = await upstreamErrorMessage(response);

    if (!looksLikeUnsupportedParamError(message)) {
      throw new Error(message);
    }

    response = await fetchWithHeadersTimeout(url, requestInit(baseBody), IMAGE_TIMEOUT_MS);
  }

  if (!response.ok) {
    throw new Error(await upstreamErrorMessage(response));
  }

  return imageUrlFromResponse(response);
}

function escapeSvg(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
