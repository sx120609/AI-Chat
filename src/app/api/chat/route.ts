import { NextRequest } from "next/server";
import {
  attachmentDataUrl,
  attachmentContextBlock,
  attachmentToView,
  contentWithAttachmentContext,
  deleteAttachmentFiles,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  readAttachmentBuffer
} from "@/lib/attachments";
import {
  ensureAttachmentsMetadata,
  ensureAttachmentsText
} from "@/lib/attachment-repair";
import {
  maybeCompressConversationContext,
  resetContextSummaryData,
  type ContextCompressionResult
} from "@/lib/context-compression";
import { getUserFromRequest } from "@/lib/auth";
import { buildContextMessages } from "@/lib/context-window";
import { jsonError, readJson, requireActiveUser } from "@/lib/http";
import { sanitizeIdentityLeak, sanitizeReasoningContent } from "@/lib/identity";
import { maybeRunFileAnalysisAgent } from "@/lib/file-analysis-agent";
import { MESSAGE_ORDER_DESC, messagesAfter, messagesBefore } from "@/lib/message-order";
import {
  mergePersistedToolEvent,
  messageProcessForClient,
  normalizeToolEvents,
  stringifyToolEvents,
  type MessageGenerationStatus,
  type PersistedToolEvent
} from "@/lib/message-process";
import {
  estimateChatCostForModel,
  estimateImageCostCents,
  getChatModel,
  isChatModel,
  normalizeReasoningEffort
} from "@/lib/models";
import { prisma } from "@/lib/prisma";
import { assertQuotaAvailable, getUsageSummary, QuotaError } from "@/lib/quota";
import { normalizePromptClock, resolveSystemPrompt } from "@/lib/system-prompt";
import { planMessageTools } from "@/lib/tool-router";
import { compactTitle, estimateTokens } from "@/lib/tokens";
import {
  assertUpstreamConfigured,
  createResponseStream,
  generateImage,
  getAiRuntimeSettings,
  uploadResponseFile,
  type AiRuntimeSettings,
  type UpstreamMessage,
  type UpstreamUsage
} from "@/lib/upstream";
import { formatWebSearchContext, searchWeb, type WebSearchSource } from "@/lib/web-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatBody = {
  conversationId?: string;
  model?: string;
  content?: string;
  reasoningEffort?: string;
  attachmentIds?: string[];
  imageToolRequested?: boolean;
  reuseUserMessageId?: string;
  sourceImageMessageId?: string;
  useWebSearch?: boolean;
  webSearchProvider?: string;
  clientDate?: string;
  clientTime?: string;
  clientTimeZone?: string;
};

const encoder = new TextEncoder();
// Codex 类模型高推理档位可能长时间不输出可见内容，看门狗放宽到 5 分钟
const IDLE_TIMEOUT_MS = 300_000;
const MAX_CONTEXT_HISTORY_MESSAGES = 120;
const DRAFT_PERSIST_INTERVAL_MS = 1000;
const SSE_KEEPALIVE_INTERVAL_MS = 15_000;
const MAX_DIRECT_FILE_INPUT_BYTES = 50 * 1024 * 1024;

class UpstreamStreamError extends Error {}

type ChatAttachment = {
  id: string;
  kind: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  extractedText: string | null;
  createdAt: Date;
};

type ToolEventPayload = {
  detail: string;
  finishedAt?: number;
  id: string;
  label: string;
  startedAt?: number;
  status: "done" | "running" | "skipped" | "error";
  type: "router" | "attachments" | "web_search" | "file_analysis" | "context_compression";
};

function normalizeRequestWebSearchProvider(value: string | undefined, fallback: string) {
  const provider = value?.trim().toLowerCase();

  if (provider === "auto" || provider === "duckduckgo") {
    return provider;
  }

  return fallback === "auto" ? fallback : "duckduckgo";
}

function sse(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: string,
  data: unknown
) {
  try {
    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    return true;
  } catch {
    return false;
  }
}

function startSseKeepAlive(controller: ReadableStreamDefaultController<Uint8Array>) {
  const timer = setInterval(() => {
    const ok = sse(controller, "ping", { now: Date.now() });

    if (!ok) {
      clearInterval(timer);
    }
  }, SSE_KEEPALIVE_INTERVAL_MS);

  return () => clearInterval(timer);
}

type StreamChoice = {
  delta?: {
    content?: string;
    reasoning_content?: string;
    reasoning?: unknown;
  };
  message?: { content?: string };
  text?: string;
};

function parseDelta(payload: unknown) {
  const json = payload as {
    choices?: StreamChoice[];
    delta?: unknown;
    output_text?: unknown;
    text?: unknown;
    type?: unknown;
  };
  const type = typeof json.type === "string" ? json.type : "";

  if (type === "response.output_text.delta" && typeof json.delta === "string") {
    return json.delta;
  }

  if (!type) {
    if (typeof json.output_text === "string") {
      return json.output_text;
    }

    if (typeof json.text === "string") {
      return json.text;
    }
  }

  return (
    json.choices
      ?.map((choice) => choice.delta?.content ?? choice.message?.content ?? choice.text ?? "")
      .join("") ?? ""
  );
}

// Sub2API / New API 等网关会把思考过程放在 delta.reasoning_content（或 delta.reasoning）里
function parseReasoningDelta(payload: unknown) {
  const json = payload as {
    choices?: StreamChoice[];
    delta?: unknown;
    text?: unknown;
    type?: unknown;
  };
  const type = typeof json.type === "string" ? json.type : "";

  if (type.includes("reasoning") && type.endsWith(".delta")) {
    if (typeof json.delta === "string") {
      return json.delta;
    }

    if (typeof json.text === "string") {
      return json.text;
    }
  }

  return (
    json.choices
      ?.map((choice) => {
        const delta = choice.delta;

        if (!delta) {
          return "";
        }

        if (typeof delta.reasoning_content === "string") {
          return delta.reasoning_content;
        }

        if (typeof delta.reasoning === "string") {
          return delta.reasoning;
        }

        return "";
      })
      .join("") ?? ""
  );
}

function parseUsage(payload: unknown): UpstreamUsage | undefined {
  const json = payload as {
    response?: { usage?: UpstreamUsage | null } | null;
    usage?: UpstreamUsage | null;
  };

  return json.usage ?? json.response?.usage ?? undefined;
}

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

function resolveTokenUsage(options: {
  completionTokensEstimate: number;
  model: ReturnType<typeof getChatModel>;
  promptTokensEstimate: number;
  upstreamUsage?: UpstreamUsage;
}) {
  const { completionTokensEstimate, model, promptTokensEstimate, upstreamUsage } = options;
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

function uniqueAttachmentIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.filter((item): item is string => typeof item === "string"))].slice(
    0,
    MAX_ATTACHMENTS_PER_MESSAGE
  );
}

function isPrivateImageHost(hostname: string) {
  const host = hostname.toLowerCase();

  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }

  if (/^(127|10)\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) {
    return true;
  }

  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd")) {
    return true;
  }

  return false;
}

async function sourceImageFromMessageUrl(imageUrl: string) {
  if (imageUrl.startsWith("data:")) {
    const match = imageUrl.match(/^data:([^;,]+);base64,(.+)$/);

    if (!match) {
      throw new Error("源图片格式无效。");
    }

    const buffer = Buffer.from(match[2], "base64");

    if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error("源图片不能超过 50 MB。");
    }

    return {
      buffer,
      mimeType: match[1] || "image/png",
      originalName: "generated-image.png"
    };
  }

  let url: URL;

  try {
    url = new URL(imageUrl);
  } catch {
    throw new Error("源图片地址无效。");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("源图片地址协议无效。");
  }

  if (isPrivateImageHost(url.hostname)) {
    throw new Error("源图片地址不能指向本机或内网。");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(url, {
      headers: {
        accept: "image/*",
        "user-agent": "TeamAIGateway/1.0"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error("源图片下载失败。");
    }

    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";

    if (!mimeType.startsWith("image/")) {
      throw new Error("源图片不是有效图片。");
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error("源图片不能超过 50 MB。");
    }

    const extension = mimeType.split("/")[1] || "png";

    return {
      buffer,
      mimeType,
      originalName: `generated-image.${extension}`
    };
  } finally {
    clearTimeout(timer);
  }
}

function directFileAttachmentIds(attachments: ChatAttachment[]) {
  const fileAttachments = attachments.filter((attachment) => attachment.kind !== "IMAGE");
  const totalSize = fileAttachments.reduce((total, attachment) => total + attachment.sizeBytes, 0);

  if (totalSize > MAX_DIRECT_FILE_INPUT_BYTES) {
    return new Set<string>();
  }

  return new Set(fileAttachments.map((attachment) => attachment.id));
}

function contentWithDirectFileContext(
  content: string,
  attachments: ChatAttachment[],
  directFileIds: Set<string>
) {
  if (directFileIds.size === 0) {
    return contentWithAttachmentContext(content, attachments);
  }

  const directFileBlocks = attachments
    .filter((attachment) => directFileIds.has(attachment.id))
    .map(
      (attachment) =>
        `[原始文件附件: ${attachment.originalName} (${attachment.mimeType})]\n` +
        "已作为原始文件随本次请求发送给模型，请优先直接解析原始文件内容。"
    );
  const fallbackAttachmentContext = attachmentContextBlock(
    attachments.filter((attachment) => !directFileIds.has(attachment.id))
  );
  const attachmentContext = [...directFileBlocks, fallbackAttachmentContext]
    .filter(Boolean)
    .join("\n\n");

  if (!attachmentContext) {
    return content;
  }

  return `${content}\n\n---\n用户上传的附件内容：\n${attachmentContext}`;
}

async function buildUserContentWithImages(content: string, attachments: ChatAttachment[]) {
  const text = contentWithAttachmentContext(content, attachments);
  const imageAttachments = attachments.filter((attachment) => attachment.kind === "IMAGE");

  if (imageAttachments.length === 0) {
    return text;
  }

  return [
    { type: "text" as const, text },
    ...(await Promise.all(
      imageAttachments.map(async (attachment) => ({
        type: "image_url" as const,
        image_url: {
          url: await attachmentDataUrl(attachment)
        }
      }))
    ))
  ];
}

type RawFileUploadOptions = {
  settings: AiRuntimeSettings;
  signal?: AbortSignal;
  uploadCache: Map<string, string>;
};

async function attachmentFilePart(
  attachment: ChatAttachment,
  options: RawFileUploadOptions | undefined
) {
  const cachedFileId = options?.uploadCache.get(attachment.id);

  if (cachedFileId) {
    return {
      filename: attachment.originalName,
      file_id: cachedFileId
    };
  }

  if (options) {
    try {
      const fileId = await uploadResponseFile(
        {
          buffer: await readAttachmentBuffer(attachment),
          filename: attachment.originalName,
          mimeType: attachment.mimeType
        },
        options.settings,
        { signal: options.signal }
      );

      options.uploadCache.set(attachment.id, fileId);

      return {
        filename: attachment.originalName,
        file_id: fileId
      };
    } catch (error) {
      console.warn(
        `[attachments] Failed to upload ${attachment.originalName} to upstream /files, falling back to file_data:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  return {
    filename: attachment.originalName,
    file_data: await attachmentDataUrl(attachment)
  };
}

async function buildUserContentWithRawFiles(
  content: string,
  attachments: ChatAttachment[],
  rawFileOptions?: RawFileUploadOptions
) {
  const directFileIds = directFileAttachmentIds(attachments);
  const text = contentWithDirectFileContext(content, attachments, directFileIds);
  const imageAttachments = attachments.filter((attachment) => attachment.kind === "IMAGE");
  const fileAttachments = attachments.filter((attachment) => directFileIds.has(attachment.id));

  if (imageAttachments.length === 0 && fileAttachments.length === 0) {
    return text;
  }

  return [
    ...(fileAttachments.length
      ? await Promise.all(
          fileAttachments.map(async (attachment) => ({
            type: "file" as const,
            file: await attachmentFilePart(attachment, rawFileOptions)
          }))
        )
      : []),
    { type: "text" as const, text },
    ...(await Promise.all(
      imageAttachments.map(async (attachment) => ({
        type: "image_url" as const,
        image_url: {
          url: await attachmentDataUrl(attachment)
        }
      }))
    ))
  ];
}

function parseStreamError(payload: unknown) {
  const json = payload as {
    error?: { message?: string } | string;
    message?: unknown;
    response?: { error?: { message?: string } | string | null } | null;
    type?: unknown;
  };
  const type = typeof json.type === "string" ? json.type : "";
  const errorField = json.error ?? json.response?.error;

  if (!errorField) {
    if (type === "error" && typeof json.message === "string") {
      return json.message;
    }

    return "";
  }

  return typeof errorField === "string"
    ? errorField
    : errorField.message || "上游在流式响应中返回了错误。";
}

function messageForClient<
  T extends {
    toolEventsJson?: string | null;
    upstreamUsageJson?: string | null;
    webSourcesJson?: string | null;
  }
>(
  message: T
) {
  const view = { ...message };

  delete view.toolEventsJson;
  delete view.upstreamUsageJson;
  delete view.webSourcesJson;

  return view;
}

async function readWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new UpstreamStreamError(
          `上游超过 ${Math.round(timeoutMs / 60_000)} 分钟没有返回新数据，连接已中断。`
        )
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([reader.read(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function pipeOpenAiSse(
  body: ReadableStream<Uint8Array>,
  handlers: {
    onDelta: (delta: string) => void;
    onReasoning: (delta: string) => void;
  }
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let usage: UpstreamUsage | undefined;

  const processBlock = (block: string) => {
    const lines = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"));

    for (const line of lines) {
      const data = line.slice(5).trim();

      if (!data || data === "[DONE]") {
        continue;
      }

      let payload: unknown;

      try {
        payload = JSON.parse(data) as unknown;
      } catch {
        continue;
      }

      const streamError = parseStreamError(payload);

      if (streamError) {
        throw new UpstreamStreamError(`上游 API 错误：${streamError}`);
      }

      const delta = parseDelta(payload);
      const reasoningDelta = parseReasoningDelta(payload);
      const nextUsage = parseUsage(payload);

      if (delta) {
        handlers.onDelta(delta);
      }

      if (reasoningDelta) {
        handlers.onReasoning(reasoningDelta);
      }

      if (nextUsage) {
        usage = nextUsage;
      }
    }
  };

  try {
    while (true) {
      const { done, value } = await readWithIdleTimeout(reader, IDLE_TIMEOUT_MS);

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        processBlock(block);
      }
    }

    if (buffer.trim()) {
      processBlock(buffer);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }

  return usage;
}

async function streamMockAnswer(
  prompt: string,
  onDelta: (delta: string) => void,
  signal?: AbortSignal
) {
  const text = `这是来自本地 Mock 模式的流式响应。你刚才说：“${prompt}”。真实部署时，请在后端设置 AI_API_KEY 和 AI_API_BASE_URL，前端不会接触密钥。`;
  const chunks = text.match(/.{1,8}/gs) ?? [text];

  for (const chunk of chunks) {
    if (signal?.aborted) {
      throw new Error("请求已停止。");
    }

    onDelta(chunk);
    await new Promise((resolve) => setTimeout(resolve, 22));
  }
}

function buildToolEvents(options: {
  attachmentCount: number;
  attachmentFinishedAt?: number;
  attachmentStartedAt?: number;
  contextCompression?: ContextCompressionResult | null;
  fileAnalysisReport: string;
  fileAnalysisFinishedAt?: number;
  fileAnalysisStartedAt?: number;
  routerFinishedAt?: number;
  routerStartedAt?: number;
  webSearchResult: Awaited<ReturnType<typeof searchWeb>>;
  webSearchFinishedAt?: number;
  webSearchStartedAt?: number;
}): ToolEventPayload[] {
  const events: ToolEventPayload[] = [];
  const usedWebSearch = Boolean(options.webSearchResult);
  const usedFileAnalysis = Boolean(options.fileAnalysisReport);
  const usedContextCompression = Boolean(options.contextCompression);
  const routeParts = [
    options.attachmentCount > 0 ? "附件上下文" : "",
    usedContextCompression ? "上下文压缩" : "",
    usedWebSearch ? "联网搜索" : "",
    usedFileAnalysis ? "文件分析" : ""
  ].filter(Boolean);

  events.push({
    detail: routeParts.length ? `已启用：${routeParts.join("、")}` : "未启用额外工具，直接对话",
    finishedAt: options.routerFinishedAt,
    id: "router",
    label: "工具状态",
    startedAt: options.routerStartedAt,
    status: "done",
    type: "router"
  });

  if (options.attachmentCount > 0) {
    events.push({
      detail: `已读取 ${options.attachmentCount} 个附件并加入上下文`,
      finishedAt: options.attachmentFinishedAt,
      id: "attachments",
      label: "附件",
      startedAt: options.attachmentStartedAt,
      status: "done",
      type: "attachments"
    });
  }

  if (options.contextCompression) {
    const result = options.contextCompression;

    events.push({
      detail: result.error ? `${result.detail}（${result.error}）` : result.detail,
      finishedAt: result.finishedAt,
      id: "context-compression",
      label: "上下文压缩",
      startedAt: result.startedAt,
      status: result.compressed ? "done" : "skipped",
      type: "context_compression"
    });
  }

  if (options.webSearchResult) {
    const sourceCount = options.webSearchResult.sources.length;

    events.push({
      detail:
        sourceCount > 0
          ? `查询“${options.webSearchResult.query}”，找到 ${sourceCount} 个来源`
          : `查询“${options.webSearchResult.query}”，没有拿到可用来源`,
      finishedAt: options.webSearchFinishedAt,
      id: "web-search",
      label: "联网搜索",
      startedAt: options.webSearchStartedAt,
      status: sourceCount > 0 ? "done" : "skipped",
      type: "web_search"
    });
  }

  if (options.fileAnalysisReport) {
    events.push({
      detail: "轻量模型已完成附件预分析",
      finishedAt: options.fileAnalysisFinishedAt,
      id: "file-analysis",
      label: "文件分析",
      startedAt: options.fileAnalysisStartedAt,
      status: "done",
      type: "file_analysis"
    });
  }

  return events;
}

export async function POST(request: NextRequest) {
  const user = await getUserFromRequest(request);
  const authError = requireActiveUser(user);

  if (!user) {
    return jsonError("请先登录。", 401);
  }

  if (authError) {
    return authError;
  }

  let body: ChatBody;

  try {
    body = await readJson<ChatBody>(request);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "发送失败。", 400);
  }

  const aiSettings = await getAiRuntimeSettings();
  const rawFileUploadCache = new Map<string, string>();
  const rawFileUploadOptions: RawFileUploadOptions = {
    settings: aiSettings,
    signal: request.signal,
    uploadCache: rawFileUploadCache
  };

  try {
    assertUpstreamConfigured(aiSettings);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "上游 API 未配置。", 500);
  }

  if (!isChatModel(body.model, aiSettings.chatModels)) {
    return jsonError("模型不在允许列表中。", 400);
  }

  const model = getChatModel(body.model, aiSettings.chatModels);
  const reasoningEffort = normalizeReasoningEffort(body.reasoningEffort);
  const reusedUserMessage = body.reuseUserMessageId
    ? await prisma.message.findFirst({
        where: {
          id: body.reuseUserMessageId,
          role: "USER",
          conversation: {
            userId: user.id
          }
        },
        include: {
          attachments: true,
          conversation: {
            include: {
              _count: {
                select: { messages: true }
              }
            }
          }
        }
      })
    : null;

  if (body.reuseUserMessageId && !reusedUserMessage) {
    return jsonError("要继续的用户消息不存在。", 404);
  }

  const attachmentIds = reusedUserMessage ? [] : uniqueAttachmentIds(body.attachmentIds);
  const content =
    body.content?.trim() ||
    reusedUserMessage?.content ||
    (attachmentIds.length ? "请根据我上传的附件进行分析。" : "");

  if (!content) {
    return jsonError("消息不能为空。", 400);
  }

  const promptClock = normalizePromptClock({
    date: body.clientDate,
    time: body.clientTime,
    timeZone: body.clientTimeZone
  });

  const existingConversation = reusedUserMessage
    ? reusedUserMessage.conversation
    : body.conversationId
    ? await prisma.conversation.findFirst({
        where: {
          id: body.conversationId,
          userId: user.id
        },
        include: {
          _count: {
            select: { messages: true }
          }
        }
      })
    : null;

  if ((body.conversationId || body.reuseUserMessageId) && !existingConversation) {
    return jsonError("会话不存在。", 404);
  }

  const routerStartedAt = Date.now();
  const attachmentStartedAt = Date.now();
  const attachments = attachmentIds.length
    ? await ensureAttachmentsMetadata(
        await prisma.attachment.findMany({
          where: {
            id: { in: attachmentIds },
            userId: user.id
          }
        })
      )
    : [];
  let attachmentFinishedAt = Date.now();

  if (attachments.length !== attachmentIds.length) {
    return jsonError("部分附件不存在或无权访问。", 404);
  }

  if (attachments.some((attachment) => attachment.messageId)) {
    return jsonError("部分附件已被发送，请重新上传后再试。", 400);
  }

  const effectiveAttachments = reusedUserMessage
    ? await ensureAttachmentsMetadata(reusedUserMessage.attachments)
    : attachments;
  attachmentFinishedAt = effectiveAttachments.length > 0 ? Date.now() : attachmentFinishedAt;

  if (reusedUserMessage) {
    const laterAttachments = await prisma.attachment.findMany({
      where: {
        message: {
          conversationId: reusedUserMessage.conversationId,
          ...messagesAfter(reusedUserMessage)
        }
      }
    });

    if (laterAttachments.length > 0) {
      await prisma.attachment.deleteMany({
        where: {
          id: {
            in: laterAttachments.map((attachment) => attachment.id)
          }
        }
      });
      await deleteAttachmentFiles(laterAttachments);
    }

    await prisma.message.deleteMany({
      where: {
        conversationId: reusedUserMessage.conversationId,
        ...messagesAfter(reusedUserMessage)
      }
    });

    await prisma.conversation.update({
      where: { id: reusedUserMessage.conversationId },
      data: resetContextSummaryData()
    });
  }

  const toolRoutePlan = await planMessageTools({
    attachmentCount: effectiveAttachments.length,
    forceSearch: body.useWebSearch === true,
    hasImageAttachment: effectiveAttachments.some((attachment) => attachment.kind === "IMAGE"),
    imageToolRequested: Boolean(body.imageToolRequested || reusedUserMessage?.mode === "IMAGE"),
    prompt: content,
    promptClock,
    settings: aiSettings,
    signal: request.signal,
    sourceImageSelected: Boolean(body.sourceImageMessageId)
  });

  if (toolRoutePlan.tool === "image") {
    const sourceImageMessage = body.sourceImageMessageId
      ? await prisma.message.findFirst({
          where: {
            id: body.sourceImageMessageId,
            imageUrl: {
              not: null
            },
            conversation: {
              userId: user.id
            }
          },
          select: {
            imageUrl: true
          }
        })
      : null;

    if (body.sourceImageMessageId && !sourceImageMessage?.imageUrl) {
      return jsonError("源图片不存在或无权访问。", 404);
    }

    const promptWithAttachmentContext = contentWithAttachmentContext(content, effectiveAttachments);
    const promptTokens = estimateTokens(promptWithAttachmentContext);
    const estimatedCostCents = estimateImageCostCents(promptTokens);

    try {
      await assertQuotaAvailable(user.id, estimatedCostCents);
    } catch (error) {
      if (error instanceof QuotaError) {
        return jsonError(error.message, error.status, { usage: error.summary });
      }

      throw error;
    }

    const imageConversation =
      existingConversation ??
      (await prisma.conversation.create({
        data: {
          userId: user.id,
          title: compactTitle(content),
          model: "image2",
          mode: "IMAGE"
        },
        include: {
          _count: {
            select: { messages: true }
          }
        }
      }));
    const imageUserMessage = reusedUserMessage
      ? await prisma.message.update({
          where: { id: reusedUserMessage.id },
          data: {
            content,
            model: "image2",
            mode: "IMAGE"
          },
          include: { attachments: true }
        })
      : await prisma.message.create({
          data: {
            conversationId: imageConversation.id,
            role: "USER",
            content,
            model: "image2",
            mode: "IMAGE"
          },
          include: { attachments: true }
        });

    if (!reusedUserMessage && attachments.length > 0) {
      await prisma.attachment.updateMany({
        where: {
          id: { in: attachments.map((attachment) => attachment.id) },
          userId: user.id
        },
        data: {
          conversationId: imageConversation.id,
          messageId: imageUserMessage.id
        }
      });
    }

    const imageUserMessageView = {
      ...imageUserMessage,
      attachments: effectiveAttachments.map(attachmentToView)
    };
    const imageRouterFinishedAt = Date.now();
    const imageStartedAt = imageRouterFinishedAt;
    const imageInitialEvents: PersistedToolEvent[] = [
      {
        detail: toolRoutePlan.reason
          ? `AI 路由选择 image2：${toolRoutePlan.reason}`
          : "AI 路由选择 image2",
        finishedAt: imageRouterFinishedAt,
        id: "router",
        label: "工具状态",
        startedAt: routerStartedAt,
        status: "done",
        type: "router"
      },
      ...(effectiveAttachments.length > 0
        ? [
            {
              detail: `已读取 ${effectiveAttachments.length} 个附件并加入生图上下文`,
              finishedAt: attachmentFinishedAt,
              id: "attachments",
              label: "附件",
              startedAt: attachmentStartedAt,
              status: "done" as const,
              type: "attachments" as const
            }
          ]
        : []),
      {
        detail:
          sourceImageMessage?.imageUrl || effectiveAttachments.some((attachment) => attachment.kind === "IMAGE")
            ? "正在基于图片生成或编辑"
            : "正在根据文字生成图片",
        id: "image",
        label: "image2",
        startedAt: imageStartedAt,
        status: "running",
        type: "image"
      }
    ];
    const imageStreamStatus = "正在使用 image2 生成图片...";
    const imageAssistantDraft = await prisma.message.create({
      data: {
        conversationId: imageConversation.id,
        role: "ASSISTANT",
        content: "生成中...",
        createdAt: new Date(Math.max(Date.now(), imageUserMessage.createdAt.getTime() + 1)),
        generationStatus: "running",
        model: "image2",
        mode: "IMAGE",
        processStartedAt: new Date(routerStartedAt),
        streamStatus: imageStreamStatus,
        toolEventsJson: stringifyToolEvents(imageInitialEvents)
      }
    });

    const imageMessageForResponse = (message: typeof imageAssistantDraft) => ({
      ...messageForClient(message),
      ...messageProcessForClient(message),
      createdAt: message.createdAt.toISOString()
    });
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const stopKeepAlive = startSseKeepAlive(controller);
        let imageEvents = imageInitialEvents;

        sse(controller, "meta", {
          conversationId: imageConversation.id,
          userMessage: {
            ...imageUserMessageView,
            createdAt: imageUserMessage.createdAt.toISOString()
          },
          assistantMessage: imageMessageForResponse(imageAssistantDraft)
        });
        for (const toolEvent of imageEvents) {
          sse(controller, "tool", toolEvent);
        }

        try {
          const sourceImages = await Promise.all(
            [
              ...effectiveAttachments
                .filter((attachment) => attachment.kind === "IMAGE")
                .map(async (attachment) => ({
                  buffer: await readAttachmentBuffer(attachment),
                  mimeType: attachment.mimeType,
                  originalName: attachment.originalName
                })),
              ...(sourceImageMessage?.imageUrl
                ? [sourceImageFromMessageUrl(sourceImageMessage.imageUrl)]
                : [])
            ]
          );
          const imageUrl = await generateImage(promptWithAttachmentContext, "1024x1024", {
            sourceImages
          });
          const finishedAt = Date.now();
          imageEvents = mergePersistedToolEvent(imageEvents, {
            detail: "图片已生成",
            finishedAt,
            id: "image",
            label: "image2",
            status: "done",
            type: "image"
          }, finishedAt);
          const assistantMessage = await prisma.message.update({
            where: { id: imageAssistantDraft.id },
            data: {
              content: "Image generated",
              estimatedCostCents,
              generationStatus: "done",
              imageUrl,
              processFinishedAt: new Date(finishedAt),
              promptTokens,
              streamStatus: "生图完成。",
              toolEventsJson: stringifyToolEvents(imageEvents),
              totalTokens: promptTokens
            }
          });

          await prisma.usageRecord.create({
            data: {
              userId: user.id,
              conversationId: imageConversation.id,
              messageId: assistantMessage.id,
              model: "image2",
              mode: "IMAGE",
              promptTokens,
              totalTokens: promptTokens,
              estimatedCostCents
            }
          });

          await prisma.conversation.update({
            where: { id: imageConversation.id },
            data: {
              mode: imageConversation._count.messages === 0 ? "IMAGE" : imageConversation.mode,
              model: imageConversation._count.messages === 0 ? "image2" : imageConversation.model,
              title:
                imageConversation._count.messages === 0
                  ? compactTitle(content)
                  : imageConversation.title
            }
          });

          const usage = await getUsageSummary(user.id, { readCache: false });
          sse(controller, "tool", imageEvents.find((event) => event.id === "image"));
          sse(controller, "done", {
            assistantMessage: imageMessageForResponse(assistantMessage),
            usage
          });
        } catch (error) {
          const finishedAt = Date.now();
          const message = error instanceof Error ? error.message : "上游生图失败。";
          imageEvents = mergePersistedToolEvent(imageEvents, {
            detail: message,
            finishedAt,
            id: "image",
            label: "image2",
            status: "error",
            type: "image"
          }, finishedAt);
          const assistantMessage = await prisma.message.update({
            where: { id: imageAssistantDraft.id },
            data: {
              content: message,
              generationStatus: "error",
              processFinishedAt: new Date(finishedAt),
              streamStatus: "生图失败。",
              toolEventsJson: stringifyToolEvents(imageEvents)
            }
          });

          sse(controller, "tool", imageEvents.find((event) => event.id === "image"));
          sse(controller, "error", {
            assistantMessage: imageMessageForResponse(assistantMessage),
            error: message
          });
        } finally {
          stopKeepAlive();
          try {
            controller.close();
          } catch {
            // The browser may have closed the stream; the message state has already been persisted.
          }
        }
      }
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive"
      }
    });
  }

  const previousMessages = existingConversation
    ? await prisma.message.findMany({
        where: {
          conversationId: existingConversation.id,
          ...(reusedUserMessage ? messagesBefore(reusedUserMessage) : {}),
          imageUrl: null,
          role: {
            in: ["USER", "ASSISTANT"]
          }
        },
        include: {
          attachments: true
        },
        orderBy: MESSAGE_ORDER_DESC,
        take: MAX_CONTEXT_HISTORY_MESSAGES
      })
    : [];
  const previousContextMessages = await Promise.all(
    previousMessages.map(async (message) => {
      const messageAttachments = await ensureAttachmentsMetadata(message.attachments);

      return {
        createdAt: message.createdAt,
        id: message.id,
        role: message.role as "USER" | "ASSISTANT",
        content: contentWithAttachmentContext(message.content, messageAttachments)
      };
    })
  );

  // 网关侧身份系统提示词：覆盖 Sub2API 等订阅型上游自带的 Codex CLI 身份设定
  const systemPrompt = resolveSystemPrompt({
    mode: aiSettings.systemPromptMode,
    customSystemPrompt: aiSettings.customSystemPrompt,
    modelSystemPrompt:
      aiSettings.modelSystemPrompts[model.id] || aiSettings.modelSystemPrompts[model.upstreamId],
    modelLabel: model.label,
    promptClock
  });
  const webSearchStartedAt = Date.now();
  const webSearchPlan = {
    query: toolRoutePlan.query,
    shouldSearch: toolRoutePlan.shouldSearch
  };
  const webSearchResult = webSearchPlan.shouldSearch
    ? await searchWeb(
        content,
        {
          ...aiSettings,
          webSearchProvider: normalizeRequestWebSearchProvider(
            body.webSearchProvider,
            aiSettings.webSearchProvider
          )
        },
        { force: true, query: webSearchPlan.query, signal: request.signal }
      )
    : null;
  const webSearchFinishedAt = Date.now();
  const webSearchSources: WebSearchSource[] = webSearchResult?.sources ?? [];
  const webSearchContext = webSearchResult?.sources.length
    ? formatWebSearchContext(webSearchResult)
    : "";
  let modelContent = webSearchContext ? `${content}\n\n---\n${webSearchContext}` : content;
  let userContent = await buildUserContentWithImages(modelContent, effectiveAttachments);
  let contextSummary = existingConversation?.contextSummary || "";
  let compressedHistoryMessageCount = existingConversation?.contextSummaryMessageCount ?? 0;
  let requestPreviousContextMessages = previousContextMessages;
  const compressionResult = await maybeCompressConversationContext({
    conversation: existingConversation,
    longContextThresholdTokens: aiSettings.longContextThresholdTokens,
    model,
    previousMessages: previousContextMessages,
    settings: aiSettings,
    signal: request.signal,
    systemPrompt,
    userContent
  });

  if (compressionResult.contextSummary !== undefined) {
    contextSummary = compressionResult.contextSummary || "";
  }

  if (compressionResult.compressedHistoryMessageCount !== undefined) {
    compressedHistoryMessageCount = compressionResult.compressedHistoryMessageCount;
  }

  requestPreviousContextMessages = compressionResult.previousMessages;

  let { contextStats, promptTokensEstimate, upstreamMessages } = buildContextMessages({
    compressedHistoryMessageCount,
    contextSummary,
    previousMessages: requestPreviousContextMessages,
    systemPrompt,
    userContent,
    model,
    longContextThresholdTokens: aiSettings.longContextThresholdTokens
  });
  upstreamMessages = buildContextMessages({
    compressedHistoryMessageCount,
    contextSummary,
    previousMessages: requestPreviousContextMessages,
    systemPrompt,
    userContent: await buildUserContentWithRawFiles(
      modelContent,
      effectiveAttachments,
      rawFileUploadOptions
    ),
    model,
    longContextThresholdTokens: aiSettings.longContextThresholdTokens
  }).upstreamMessages;
  const buildFallbackUpstreamMessages = directFileAttachmentIds(effectiveAttachments).size > 0
    ? async (): Promise<UpstreamMessage[]> => {
        const fallbackAttachments = await ensureAttachmentsText(effectiveAttachments);
        const fallbackUserContent = await buildUserContentWithImages(
          modelContent,
          fallbackAttachments
        );

        return buildContextMessages({
          compressedHistoryMessageCount,
          contextSummary,
          previousMessages: requestPreviousContextMessages,
          systemPrompt,
          userContent: fallbackUserContent,
          model,
          longContextThresholdTokens: aiSettings.longContextThresholdTokens
        }).upstreamMessages;
      }
    : undefined;
  const quotaCostEstimate = estimateChatCostForModel(model, promptTokensEstimate, 0);

  try {
    await assertQuotaAvailable(user.id, quotaCostEstimate);
  } catch (error) {
    if (error instanceof QuotaError) {
      return jsonError(error.message, error.status, { usage: error.summary });
    }

    throw error;
  }

  const fileAnalysisStartedAt = Date.now();
  const fileAnalysisReport = await maybeRunFileAnalysisAgent({
    attachments: effectiveAttachments,
    prompt: content,
    signal: request.signal,
    settings: aiSettings
  });
  const fileAnalysisFinishedAt = Date.now();

  if (fileAnalysisReport) {
    modelContent = `${content}${webSearchContext ? `\n\n---\n${webSearchContext}` : ""}\n\n---\n${fileAnalysisReport}`;
    userContent = await buildUserContentWithImages(modelContent, effectiveAttachments);
    const rebuiltContext = buildContextMessages({
      compressedHistoryMessageCount,
      contextSummary,
      previousMessages: requestPreviousContextMessages,
      systemPrompt,
      userContent,
      model,
      longContextThresholdTokens: aiSettings.longContextThresholdTokens
    });
    contextStats = rebuiltContext.contextStats;
    promptTokensEstimate = rebuiltContext.promptTokensEstimate;
    upstreamMessages = buildContextMessages({
      compressedHistoryMessageCount,
      contextSummary,
      previousMessages: requestPreviousContextMessages,
      systemPrompt,
      userContent: await buildUserContentWithRawFiles(
        modelContent,
        effectiveAttachments,
        rawFileUploadOptions
      ),
      model,
      longContextThresholdTokens: aiSettings.longContextThresholdTokens
    }).upstreamMessages;

    try {
      await assertQuotaAvailable(user.id, estimateChatCostForModel(model, promptTokensEstimate, 0));
    } catch (error) {
      if (error instanceof QuotaError) {
        return jsonError(error.message, error.status, { usage: error.summary });
      }

      throw error;
    }
  }

  const conversation =
    existingConversation ??
    (await prisma.conversation.create({
      data: {
        userId: user.id,
        title: compactTitle(content),
        model: model.id,
        mode: "CHAT"
      },
      include: {
        _count: {
          select: { messages: true }
        }
      }
    }));

  const userMessage =
    reusedUserMessage ??
    (await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "USER",
        content,
        model: model.id,
        mode: "CHAT"
      }
    }));

  if (attachments.length > 0) {
    await prisma.attachment.updateMany({
      where: {
        id: { in: attachments.map((attachment) => attachment.id) },
        userId: user.id
      },
      data: {
        conversationId: conversation.id,
        messageId: userMessage.id
      }
    });
  }

  const userMessageView = {
    ...userMessage,
    attachments: effectiveAttachments.map(attachmentToView)
  };
  const routerFinishedAt = Date.now();
  const toolEvents = buildToolEvents({
    attachmentCount: effectiveAttachments.length,
    attachmentFinishedAt,
    attachmentStartedAt,
    contextCompression: compressionResult.compression,
    fileAnalysisReport,
    fileAnalysisFinishedAt,
    fileAnalysisStartedAt,
    routerFinishedAt,
    routerStartedAt,
    webSearchResult,
    webSearchFinishedAt,
    webSearchStartedAt
  });
  const initialStreamStatus = "工具路由完成，等待模型输出...";
  const initialProcessToolEvents = mergePersistedToolEvent(
    normalizeToolEvents(toolEvents),
    {
      detail: "等待模型输出",
      id: "generation",
      label: "模型生成",
      startedAt: routerFinishedAt,
      status: "running",
      type: "generation"
    },
    routerFinishedAt
  );
  const assistantDraftMessage = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: "ASSISTANT",
      content: "",
      reasoningContent: null,
      createdAt: new Date(Math.max(Date.now(), userMessage.createdAt.getTime() + 1)),
      model: model.id,
      mode: "CHAT",
      webSourcesJson: JSON.stringify(webSearchSources),
      generationStatus: "running",
      streamStatus: initialStreamStatus,
      toolEventsJson: stringifyToolEvents(initialProcessToolEvents),
      processStartedAt: new Date(routerStartedAt)
    }
  });
  const streamAbortController = new AbortController();
  const abortStream = () => streamAbortController.abort();

  if (request.signal.aborted) {
    abortStream();
  } else {
    request.signal.addEventListener("abort", abortStream, { once: true });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const stopKeepAlive = startSseKeepAlive(controller);
      let assistantContent = "";
      let reasoningContent = "";
      let currentStreamStatus = initialStreamStatus;
      let draftPersistPromise = Promise.resolve();
      let generationStreamStarted = false;
      let lastDraftPersistAt = 0;
      let processToolEvents: PersistedToolEvent[] = initialProcessToolEvents;
      let usageRecordCreated = false;

      const assistantMessageForResponse = (message: typeof assistantDraftMessage) => ({
        ...messageForClient(message),
        ...messageProcessForClient(message),
        webSources: webSearchSources,
        createdAt: message.createdAt.toISOString()
      });

      const persistDraftSnapshot = async () => {
        const visibleAssistantContent = sanitizeIdentityLeak(assistantContent, model.label);
        const visibleReasoningContent = sanitizeReasoningContent(reasoningContent, model.label);

        await prisma.message
          .update({
            where: { id: assistantDraftMessage.id },
            data: {
              content: visibleAssistantContent,
              reasoningContent: visibleReasoningContent || null,
              generationStatus: "running",
              streamStatus: currentStreamStatus,
              toolEventsJson: stringifyToolEvents(processToolEvents)
            }
          })
          .catch(() => undefined);
      };

      const queueDraftPersist = (force = false) => {
        const now = Date.now();

        if (!force && now - lastDraftPersistAt < DRAFT_PERSIST_INTERVAL_MS) {
          return;
        }

        lastDraftPersistAt = now;
        draftPersistPromise = draftPersistPromise.then(persistDraftSnapshot, persistDraftSnapshot);
      };

      const upsertProcessToolEvent = (
        event: Omit<PersistedToolEvent, "startedAt"> & Partial<Pick<PersistedToolEvent, "startedAt">>,
        now = Date.now(),
        persist = true
      ) => {
        processToolEvents = mergePersistedToolEvent(processToolEvents, event, now);

        if (persist) {
          queueDraftPersist(event.status !== "running");
        }
      };

      const markModelOutputStarted = (detail: string, status: string) => {
        if (generationStreamStarted) {
          return;
        }

        generationStreamStarted = true;
        currentStreamStatus = status;
        upsertProcessToolEvent({
          detail,
          id: "generation",
          label: "模型生成",
          status: "running",
          type: "generation"
        });
      };

      const finalizeAssistantMessage = async (options: {
        errorMessage?: string;
        finishedAt?: number;
        status: MessageGenerationStatus;
        streamStatus: string;
        upstreamUsage?: UpstreamUsage;
      }) => {
        await draftPersistPromise.catch(() => undefined);

        const finishedAt = options.finishedAt ?? Date.now();
        currentStreamStatus = options.streamStatus;
        processToolEvents = processToolEvents.map((event) =>
          event.status === "running"
            ? {
                ...event,
                detail: event.id === "generation" ? options.streamStatus : event.detail,
                finishedAt,
                status: options.status === "error" ? ("error" as const) : ("skipped" as const)
              }
            : event
        );

        const visibleAssistantContent = sanitizeIdentityLeak(assistantContent, model.label);
        const visibleReasoningContent = sanitizeReasoningContent(reasoningContent, model.label);
        const contentForHistory =
          visibleAssistantContent ||
          (options.errorMessage && !visibleReasoningContent ? options.errorMessage : "");
        const shouldRecordUsage = Boolean(
          options.upstreamUsage || visibleAssistantContent || visibleReasoningContent
        );
        const tokenUsage = shouldRecordUsage
          ? resolveTokenUsage({
              completionTokensEstimate: Math.max(
                1,
                estimateTokens(visibleAssistantContent) + estimateTokens(reasoningContent)
              ),
              model,
              promptTokensEstimate,
              upstreamUsage: options.upstreamUsage
            })
          : null;

        const assistantMessage = await prisma.message.update({
          where: { id: assistantDraftMessage.id },
          data: {
            content: contentForHistory,
            reasoningContent: visibleReasoningContent || null,
            generationStatus: options.status,
            streamStatus: options.streamStatus,
            toolEventsJson: stringifyToolEvents(processToolEvents),
            processFinishedAt: new Date(finishedAt),
            ...(tokenUsage
              ? {
                  promptTokens: tokenUsage.promptTokens,
                  completionTokens: tokenUsage.completionTokens,
                  totalTokens: tokenUsage.totalTokens,
                  cachedPromptTokens: tokenUsage.cachedPromptTokens,
                  reasoningTokens: tokenUsage.reasoningTokens,
                  usageSource: tokenUsage.usageSource,
                  upstreamUsageJson: tokenUsage.upstreamUsageJson,
                  estimatedCostCents: tokenUsage.estimatedCostCents
                }
              : {})
          }
        });

        if (tokenUsage && !usageRecordCreated) {
          usageRecordCreated = true;
          await prisma.usageRecord.create({
            data: {
              userId: user.id,
              conversationId: conversation.id,
              messageId: assistantDraftMessage.id,
              model: model.id,
              mode: "CHAT",
              promptTokens: tokenUsage.promptTokens,
              completionTokens: tokenUsage.completionTokens,
              totalTokens: tokenUsage.totalTokens,
              cachedPromptTokens: tokenUsage.cachedPromptTokens,
              reasoningTokens: tokenUsage.reasoningTokens,
              usageSource: tokenUsage.usageSource,
              upstreamUsageJson: tokenUsage.upstreamUsageJson,
              estimatedCostCents: tokenUsage.estimatedCostCents
            }
          });
        }

        await prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            model: model.id,
            mode: "CHAT",
            title: conversation._count.messages === 0 ? compactTitle(content) : conversation.title
          }
        });

        return assistantMessage;
      };

      sse(controller, "meta", {
        conversationId: conversation.id,
        userMessage: {
          ...userMessageView,
          createdAt: userMessage.createdAt.toISOString()
        },
        assistantMessage: assistantMessageForResponse(assistantDraftMessage),
        context: contextStats
      });
      for (const toolEvent of toolEvents) {
        sse(controller, "tool", toolEvent);
      }

      try {
        let upstreamUsage: UpstreamUsage | undefined;

        if (aiSettings.mockResponses) {
          await streamMockAnswer(content, (delta) => {
            assistantContent += delta;
            markModelOutputStarted("正在流式输出回答", "正在流式输出...");
            queueDraftPersist();
            sse(controller, "delta", { delta });
          }, streamAbortController.signal);
        } else {
          const upstreamBody = await createResponseStream(
            model.id,
            upstreamMessages,
            aiSettings,
            {
              fallbackMessages: buildFallbackUpstreamMessages,
              reasoningEffort,
              signal: streamAbortController.signal
            }
          );
          upstreamUsage = await pipeOpenAiSse(upstreamBody, {
            onDelta: (delta) => {
              assistantContent += delta;
              markModelOutputStarted("正在流式输出回答", "正在流式输出...");
              queueDraftPersist();
              sse(controller, "delta", { delta });
            },
            onReasoning: (delta) => {
              reasoningContent += delta;
              markModelOutputStarted("正在接收思考过程", "正在思考...");
              queueDraftPersist();
            }
          });
        }

        const finishedAt = Date.now();
        const doneDetail = assistantContent
          ? "回答已生成"
          : reasoningContent
            ? "思考过程已保存，但没有返回可见文本"
            : "上游已完成，但没有返回可见文本";
        const doneStatus = assistantContent
          ? "已完成。"
          : reasoningContent
            ? "已完成，未返回可见文本。"
            : "上游已完成，但没有返回可见文本。";

        upsertProcessToolEvent(
          {
            detail: doneDetail,
            finishedAt,
            id: "generation",
            label: "模型生成",
            status: "done",
            type: "generation"
          },
          finishedAt,
          false
        );
        upsertProcessToolEvent(
          {
            detail: "已更新本月用量和费用",
            finishedAt,
            id: "usage",
            label: "用量统计",
            status: "done",
            type: "usage"
          },
          finishedAt,
          false
        );
        const assistantMessage = await finalizeAssistantMessage({
          finishedAt,
          status: "done",
          streamStatus: doneStatus,
          upstreamUsage
        });
        const usage = await getUsageSummary(user.id, { readCache: false });
        const visibleReasoningContent = sanitizeReasoningContent(reasoningContent, model.label);

        if (visibleReasoningContent) {
          sse(controller, "reasoning", { delta: visibleReasoningContent });
        }

        sse(controller, "done", {
          assistantMessage: assistantMessageForResponse(assistantMessage),
          usage
        });
      } catch (error) {
        const finishedAt = Date.now();
        const aborted = streamAbortController.signal.aborted;
        const errorMessage = error instanceof Error ? error.message : "上游调用失败。";
        const streamStatus = aborted
          ? assistantContent || reasoningContent
            ? "连接已中断，已保存部分内容。"
            : "连接已中断，未收到模型输出。"
          : "上游调用失败。";
        upsertProcessToolEvent(
          {
            detail: aborted ? streamStatus : errorMessage,
            finishedAt,
            id: "generation",
            label: "模型生成",
            status: aborted ? "skipped" : "error",
            type: "generation"
          },
          finishedAt,
          false
        );
        const assistantMessage = await finalizeAssistantMessage({
          errorMessage: assistantContent || reasoningContent ? undefined : errorMessage,
          finishedAt,
          status: aborted ? "stopped" : "error",
          streamStatus
        }).catch(() => null);

        if (!aborted) {
          sse(controller, "error", {
            assistantMessage: assistantMessage ? assistantMessageForResponse(assistantMessage) : null,
            error: errorMessage
          });
        }
      } finally {
        stopKeepAlive();
        request.signal.removeEventListener("abort", abortStream);
        try {
          controller.close();
        } catch {
          // The browser may have already gone away; persistence above is the source of truth.
        }
      }
    },
    cancel() {
      abortStream();
    }
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive"
    }
  });
}
