import { NextRequest } from "next/server";
import {
  attachmentDataUrl,
  attachmentToView,
  contentWithAttachmentContext,
  deleteAttachmentFiles,
  MAX_ATTACHMENTS_PER_MESSAGE
} from "@/lib/attachments";
import { ensureAttachmentsText } from "@/lib/attachment-repair";
import { getUserFromRequest } from "@/lib/auth";
import { buildContextMessages } from "@/lib/context-window";
import { jsonError, readJson, requireActiveUser } from "@/lib/http";
import { sanitizeIdentityLeak, sanitizeReasoningContent } from "@/lib/identity";
import { maybeRunFileAnalysisAgent } from "@/lib/file-analysis-agent";
import {
  estimateChatCostForModel,
  getChatModel,
  isChatModel,
  normalizeReasoningEffort
} from "@/lib/models";
import { prisma } from "@/lib/prisma";
import { assertQuotaAvailable, getUsageSummary, QuotaError } from "@/lib/quota";
import { planWebSearchQuery } from "@/lib/search-planner";
import { resolveSystemPrompt } from "@/lib/system-prompt";
import { compactTitle, estimateTokens } from "@/lib/tokens";
import {
  assertUpstreamConfigured,
  createChatCompletionStream,
  getAiRuntimeSettings,
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
  reuseUserMessageId?: string;
  useWebSearch?: boolean;
  webSearchProvider?: string;
};

const encoder = new TextEncoder();
// Codex 类模型高推理档位可能长时间不输出可见内容，看门狗放宽到 5 分钟
const IDLE_TIMEOUT_MS = 300_000;
const MAX_CONTEXT_HISTORY_MESSAGES = 120;

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
  id: string;
  label: string;
  status: "done" | "running" | "skipped" | "error";
  type: "router" | "attachments" | "web_search" | "file_analysis";
};

function normalizeRequestWebSearchProvider(value: string | undefined, fallback: string) {
  const provider = value?.trim().toLowerCase();

  if (provider === "auto" || provider === "bing" || provider === "duckduckgo" || provider === "google") {
    return provider;
  }

  return fallback === "bing" || fallback === "google" ? fallback : "duckduckgo";
}

function sse(controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: unknown) {
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
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
  const json = payload as { choices?: StreamChoice[] };

  return (
    json.choices
      ?.map((choice) => choice.delta?.content ?? choice.message?.content ?? choice.text ?? "")
      .join("") ?? ""
  );
}

// Sub2API / New API 等网关会把思考过程放在 delta.reasoning_content（或 delta.reasoning）里
function parseReasoningDelta(payload: unknown) {
  const json = payload as { choices?: StreamChoice[] };

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
  const json = payload as { usage?: UpstreamUsage | null };

  return json.usage ?? undefined;
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

function parseStreamError(payload: unknown) {
  const errorField = (payload as { error?: { message?: string } | string }).error;

  if (!errorField) {
    return "";
  }

  return typeof errorField === "string"
    ? errorField
    : errorField.message || "上游在流式响应中返回了错误。";
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
  fileAnalysisReport: string;
  webSearchResult: Awaited<ReturnType<typeof searchWeb>>;
}): ToolEventPayload[] {
  const events: ToolEventPayload[] = [];
  const usedWebSearch = Boolean(options.webSearchResult);
  const usedFileAnalysis = Boolean(options.fileAnalysisReport);
  const routeParts = [
    options.attachmentCount > 0 ? "附件上下文" : "",
    usedWebSearch ? "联网搜索" : "",
    usedFileAnalysis ? "文件分析" : ""
  ].filter(Boolean);

  events.push({
    detail: routeParts.length ? `已启用：${routeParts.join("、")}` : "未启用额外工具，直接对话",
    id: "router",
    label: "工具状态",
    status: "done",
    type: "router"
  });

  if (options.attachmentCount > 0) {
    events.push({
      detail: `已读取 ${options.attachmentCount} 个附件并加入上下文`,
      id: "attachments",
      label: "附件",
      status: "done",
      type: "attachments"
    });
  }

  if (options.webSearchResult) {
    const sourceCount = options.webSearchResult.sources.length;

    events.push({
      detail:
        sourceCount > 0
          ? `查询“${options.webSearchResult.query}”，找到 ${sourceCount} 个来源`
          : `查询“${options.webSearchResult.query}”，没有拿到可用来源`,
      id: "web-search",
      label: "联网搜索",
      status: sourceCount > 0 ? "done" : "skipped",
      type: "web_search"
    });
  }

  if (options.fileAnalysisReport) {
    events.push({
      detail: "沙箱文件分析已完成",
      id: "file-analysis",
      label: "文件分析",
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

  const attachments = attachmentIds.length
    ? await ensureAttachmentsText(
        await prisma.attachment.findMany({
          where: {
            id: { in: attachmentIds },
            userId: user.id
          }
        })
      )
    : [];

  if (attachments.length !== attachmentIds.length) {
    return jsonError("部分附件不存在或无权访问。", 404);
  }

  if (attachments.some((attachment) => attachment.messageId)) {
    return jsonError("部分附件已被发送，请重新上传后再试。", 400);
  }

  const effectiveAttachments = reusedUserMessage
    ? await ensureAttachmentsText(reusedUserMessage.attachments)
    : attachments;

  if (reusedUserMessage) {
    const laterAttachments = await prisma.attachment.findMany({
      where: {
        message: {
          conversationId: reusedUserMessage.conversationId,
          id: {
            gt: reusedUserMessage.id
          }
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
        id: {
          gt: reusedUserMessage.id
        }
      }
    });
  }

  const previousMessages = existingConversation
    ? await prisma.message.findMany({
        where: {
          conversationId: existingConversation.id,
          ...(reusedUserMessage
            ? {
                id: {
                  lt: reusedUserMessage.id
                }
              }
            : {}),
          imageUrl: null,
          role: {
            in: ["USER", "ASSISTANT"]
          }
        },
        include: {
          attachments: true
        },
        orderBy: { id: "desc" },
        take: MAX_CONTEXT_HISTORY_MESSAGES
      })
    : [];
  const previousContextMessages = await Promise.all(
    previousMessages.map(async (message) => {
      const messageAttachments = await ensureAttachmentsText(message.attachments);

      return {
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
    modelLabel: model.label
  });
  const webSearchPlan = await planWebSearchQuery({
    attachmentCount: effectiveAttachments.length,
    force: body.useWebSearch === true,
    modelId: model.id,
    prompt: content,
    signal: request.signal,
    settings: aiSettings
  });
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
  const webSearchSources: WebSearchSource[] = webSearchResult?.sources ?? [];
  const webSearchContext = webSearchResult?.sources.length
    ? formatWebSearchContext(webSearchResult)
    : "";
  let modelContent = webSearchContext ? `${content}\n\n---\n${webSearchContext}` : content;
  let userContent = await buildUserContentWithImages(modelContent, effectiveAttachments);
  let { contextStats, promptTokensEstimate, upstreamMessages } = buildContextMessages({
    previousMessages: previousContextMessages,
    systemPrompt,
    userContent,
    model,
    longContextThresholdTokens: aiSettings.longContextThresholdTokens
  });
  const quotaCostEstimate = estimateChatCostForModel(model, promptTokensEstimate, 0);

  try {
    await assertQuotaAvailable(user.id, quotaCostEstimate);
  } catch (error) {
    if (error instanceof QuotaError) {
      return jsonError(error.message, error.status, { usage: error.summary });
    }

    throw error;
  }

  const fileAnalysisReport = await maybeRunFileAnalysisAgent({
    attachments: effectiveAttachments,
    modelId: model.id,
    prompt: content,
    settings: aiSettings
  });

  if (fileAnalysisReport) {
    modelContent = `${content}${webSearchContext ? `\n\n---\n${webSearchContext}` : ""}\n\n---\n${fileAnalysisReport}`;
    userContent = await buildUserContentWithImages(modelContent, effectiveAttachments);
    const rebuiltContext = buildContextMessages({
      previousMessages: previousContextMessages,
      systemPrompt,
      userContent,
      model,
      longContextThresholdTokens: aiSettings.longContextThresholdTokens
    });
    contextStats = rebuiltContext.contextStats;
    promptTokensEstimate = rebuiltContext.promptTokensEstimate;
    upstreamMessages = rebuiltContext.upstreamMessages;

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
  const toolEvents = buildToolEvents({
    attachmentCount: effectiveAttachments.length,
    fileAnalysisReport,
    webSearchResult
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
      let assistantContent = "";
      let reasoningContent = "";

      sse(controller, "meta", {
        conversationId: conversation.id,
        userMessage: {
          ...userMessageView,
          createdAt: userMessage.createdAt.toISOString()
        },
        context: contextStats
      });
      for (const toolEvent of toolEvents) {
        sse(controller, "tool", toolEvent);
      }

      const persistAssistantMessage = async (upstreamUsage: UpstreamUsage | undefined) => {
        const visibleAssistantContent = sanitizeIdentityLeak(assistantContent, model.label);
        const visibleReasoningContent = sanitizeReasoningContent(reasoningContent, model.label);
        const promptTokens = upstreamUsage?.prompt_tokens ?? promptTokensEstimate;
        const completionTokens =
          upstreamUsage?.completion_tokens ??
          Math.max(1, estimateTokens(visibleAssistantContent) + estimateTokens(reasoningContent));
        const totalTokens = upstreamUsage?.total_tokens ?? promptTokens + completionTokens;
        const estimatedCostCents = estimateChatCostForModel(model, promptTokens, completionTokens);

        const assistantMessage = await prisma.message.create({
          data: {
            conversationId: conversation.id,
            role: "ASSISTANT",
            content: visibleAssistantContent,
            reasoningContent: visibleReasoningContent || null,
            model: model.id,
            mode: "CHAT",
            webSourcesJson: JSON.stringify(webSearchSources),
            promptTokens,
            completionTokens,
            totalTokens,
            estimatedCostCents
          }
        });

        await prisma.usageRecord.create({
          data: {
            userId: user.id,
            conversationId: conversation.id,
            messageId: assistantMessage.id,
            model: model.id,
            mode: "CHAT",
            promptTokens,
            completionTokens,
            totalTokens,
            estimatedCostCents
          }
        });

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

      try {
        let upstreamUsage: UpstreamUsage | undefined;

        if (aiSettings.mockResponses) {
          await streamMockAnswer(content, (delta) => {
            assistantContent += delta;
            sse(controller, "delta", { delta });
          }, streamAbortController.signal);
        } else {
          const upstreamBody = await createChatCompletionStream(
            model.id,
            upstreamMessages,
            aiSettings,
            { reasoningEffort, signal: streamAbortController.signal }
          );
          upstreamUsage = await pipeOpenAiSse(upstreamBody, {
            onDelta: (delta) => {
              assistantContent += delta;
              sse(controller, "delta", { delta });
            },
            onReasoning: (delta) => {
              reasoningContent += delta;
            }
          });
        }

        const assistantMessage = await persistAssistantMessage(upstreamUsage);
        const usage = await getUsageSummary(user.id, { readCache: false });
        const visibleReasoningContent = sanitizeReasoningContent(reasoningContent, model.label);

        if (visibleReasoningContent) {
          sse(controller, "reasoning", { delta: visibleReasoningContent });
        }

        sse(controller, "done", {
          assistantMessage: {
            ...assistantMessage,
            webSources: webSearchSources,
            createdAt: assistantMessage.createdAt.toISOString()
          },
          usage
        });
      } catch (error) {
        // 流中断时若已收到部分回复，仍然保存并计费，避免已消耗的 token 不被统计
        if (assistantContent || reasoningContent) {
          await persistAssistantMessage(undefined).catch(() => undefined);
        }

        if (!streamAbortController.signal.aborted) {
          sse(controller, "error", {
            error: error instanceof Error ? error.message : "上游调用失败。"
          });
        }
      } finally {
        request.signal.removeEventListener("abort", abortStream);
        controller.close();
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
