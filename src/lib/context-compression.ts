import {
  buildContextMessages,
  type ConversationHistoryMessage
} from "@/lib/context-window";
import {
  capContextWindowTokens,
  type ChatModelConfig
} from "@/lib/models";
import { prisma } from "@/lib/prisma";
import {
  createChatCompletionText,
  type AiRuntimeSettings,
  type UpstreamChatMessage
} from "@/lib/upstream";
import {
  estimateMessagesTokens,
  estimateTokens,
  type ChatMessageContent
} from "@/lib/tokens";

export type CompressibleHistoryMessage = ConversationHistoryMessage & {
  createdAt: Date;
  id: string;
};

export type ConversationContextState = {
  contextSummary?: string | null;
  contextSummaryMessageCount?: number | null;
  contextSummaryTokens?: number | null;
  contextSummaryUntilCreatedAt?: Date | null;
  contextSummaryUntilMessageId?: string | null;
  id: string;
};

export type ContextCompressionResult = {
  compressed: boolean;
  detail: string;
  error?: string;
  finishedAt?: number;
  keptMessageCount: number;
  omittedBeforeCompression: number;
  previousPromptTokens: number;
  startedAt?: number;
  summarizedMessageCount: number;
  summaryTokens: number;
};

const MIN_LIVE_MESSAGES_TO_COMPRESS = 10;
const MIN_OLDER_MESSAGES_TO_COMPRESS = 4;
const MAX_COMPRESSION_INPUT_TOKENS = 120_000;
const MAX_SUMMARY_CHARS = 36_000;

export function resetContextSummaryData() {
  return {
    contextSummary: null,
    contextSummaryMessageCount: 0,
    contextSummaryTokens: 0,
    contextSummaryUntilCreatedAt: null,
    contextSummaryUntilMessageId: null,
    contextSummaryUpdatedAt: null
  };
}

function messageTokens(message: ConversationHistoryMessage) {
  return estimateMessagesTokens([
    {
      role: message.role === "ASSISTANT" ? "assistant" : "user",
      content: message.content
    }
  ]);
}

function splitHistoryForCompression(messages: CompressibleHistoryMessage[], model: ChatModelConfig) {
  const contextWindowTokens = capContextWindowTokens(model.contextWindowTokens);
  const targetRecentTokens = Math.max(24_000, Math.floor(contextWindowTokens * 0.34));
  const recentMessages: CompressibleHistoryMessage[] = [];
  let recentTokens = 0;

  for (const message of messages) {
    const nextTokens = messageTokens(message);

    if (recentMessages.length >= 8 && recentTokens + nextTokens > targetRecentTokens) {
      break;
    }

    recentMessages.push(message);
    recentTokens += nextTokens;
  }

  return {
    olderMessages: messages.slice(recentMessages.length),
    recentMessages
  };
}

function formatMessageForCompression(message: CompressibleHistoryMessage) {
  const role = message.role === "ASSISTANT" ? "助手" : "用户";
  const time = message.createdAt.toISOString();

  return `### ${role} · ${time}\n${message.content.trim()}`;
}

function clampCompressionTranscript(text: string) {
  const lines = text.split("\n");
  const kept: string[] = [];
  let tokens = 0;

  for (const line of lines) {
    const nextTokens = estimateTokens(line) + 1;

    if (tokens + nextTokens > MAX_COMPRESSION_INPUT_TOKENS) {
      kept.push("\n[较早内容因压缩输入预算已截断]");
      break;
    }

    kept.push(line);
    tokens += nextTokens;
  }

  return kept.join("\n").slice(0, 420_000);
}

function normalizeSummary(text: string) {
  return text
    .replace(/^```(?:markdown|md|text)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim()
    .slice(0, MAX_SUMMARY_CHARS);
}

function localFallbackSummary(options: {
  existingSummary: string;
  olderMessages: CompressibleHistoryMessage[];
}) {
  const chunks = options.olderMessages
    .slice()
    .reverse()
    .map(formatMessageForCompression)
    .join("\n\n")
    .slice(-18_000);

  return normalizeSummary(
    [
      "## 压缩摘要",
      options.existingSummary ? `### 既有摘要\n${options.existingSummary}` : "",
      "### 较早对话要点",
      chunks || "无可压缩内容。"
    ]
      .filter(Boolean)
      .join("\n\n")
  );
}

async function createContextSummary(options: {
  existingSummary: string;
  model: ChatModelConfig;
  olderMessages: CompressibleHistoryMessage[];
  settings: AiRuntimeSettings;
  signal?: AbortSignal;
}) {
  if (options.settings.mockResponses) {
    return localFallbackSummary(options);
  }

  const transcript = clampCompressionTranscript(
    options.olderMessages
      .slice()
      .reverse()
      .map(formatMessageForCompression)
      .join("\n\n")
  );
  const messages: UpstreamChatMessage[] = [
    {
      role: "system",
      content:
        "你是对话上下文压缩器。你的任务是把较早聊天压缩成后续模型可继续使用的事实摘要。保留用户目标、偏好、关键结论、文件/附件信息、未完成任务、重要约束、已做决定和需要避免重复的错误。删除寒暄、重复推理和无用过程。不要编造。只输出中文摘要。"
    },
    {
      role: "user",
      content: [
        options.existingSummary
          ? `【已有压缩摘要】\n${options.existingSummary}`
          : "【已有压缩摘要】\n无",
        `【需要合并压缩的较早对话】\n${transcript}`,
        "请输出新的统一摘要。建议使用简短分组标题，控制在 1200-2500 字。"
      ].join("\n\n---\n\n")
    }
  ];

  return normalizeSummary(
    await createChatCompletionText(options.model.id, messages, options.settings, {
      signal: options.signal
    })
  );
}

export async function maybeCompressConversationContext(options: {
  conversation: ConversationContextState | null;
  longContextThresholdTokens: number;
  model: ChatModelConfig;
  previousMessages: CompressibleHistoryMessage[];
  settings: AiRuntimeSettings;
  signal?: AbortSignal;
  systemPrompt: string;
  userContent?: ChatMessageContent;
}) {
  const existingSummary = options.conversation?.contextSummary?.trim() || "";
  const cutoff = options.conversation?.contextSummaryUntilCreatedAt ?? null;
  const liveMessages = cutoff
    ? options.previousMessages.filter((message) => message.createdAt > cutoff)
    : options.previousMessages;
  const compressedHistoryMessageCount = options.conversation?.contextSummaryMessageCount ?? 0;
  const initialContext = buildContextMessages({
    compressedHistoryMessageCount,
    contextSummary: existingSummary,
    longContextThresholdTokens: options.longContextThresholdTokens,
    model: options.model,
    previousMessages: liveMessages,
    systemPrompt: options.systemPrompt,
    userContent: options.userContent
  });
  const shouldCompress =
    Boolean(options.conversation) &&
    options.settings.contextCompressionEnabled &&
    liveMessages.length >= MIN_LIVE_MESSAGES_TO_COMPRESS &&
    (initialContext.contextStats.contextWindowPercent >=
      options.settings.contextCompressionThresholdPercent ||
      initialContext.contextStats.omittedHistoryMessageCount > 0);

  if (!shouldCompress || !options.conversation) {
    return {
      compression: null,
      contextSummary: existingSummary,
      previousMessages: liveMessages
    };
  }

  const startedAt = Date.now();
  const { olderMessages, recentMessages } = splitHistoryForCompression(
    liveMessages,
    options.model
  );

  if (olderMessages.length < MIN_OLDER_MESSAGES_TO_COMPRESS) {
    return {
      compression: {
        compressed: false,
        detail: "上下文接近上限，但可压缩的较早历史不足，继续使用自动裁剪。",
        finishedAt: Date.now(),
        keptMessageCount: recentMessages.length,
        omittedBeforeCompression: initialContext.contextStats.omittedHistoryMessageCount,
        previousPromptTokens: initialContext.promptTokensEstimate,
        startedAt,
        summarizedMessageCount: 0,
        summaryTokens: estimateTokens(existingSummary)
      } satisfies ContextCompressionResult,
      contextSummary: existingSummary,
      previousMessages: liveMessages
    };
  }

  try {
    const nextSummary = await createContextSummary({
      existingSummary,
      model: options.model,
      olderMessages,
      settings: options.settings,
      signal: options.signal
    });

    if (!nextSummary) {
      throw new Error("上游没有返回压缩摘要。");
    }

    const newestSummarizedMessage = olderMessages[0];
    const nextSummaryTokens = estimateTokens(nextSummary);
    const nextCompressedMessageCount =
      compressedHistoryMessageCount + olderMessages.length;

    await prisma.conversation.update({
      where: { id: options.conversation.id },
      data: {
        contextSummary: nextSummary,
        contextSummaryMessageCount: nextCompressedMessageCount,
        contextSummaryTokens: nextSummaryTokens,
        contextSummaryUntilCreatedAt: newestSummarizedMessage.createdAt,
        contextSummaryUntilMessageId: newestSummarizedMessage.id,
        contextSummaryUpdatedAt: new Date()
      }
    });

    return {
      compression: {
        compressed: true,
        detail: `已压缩 ${olderMessages.length} 条较早历史，保留最近 ${recentMessages.length} 条。`,
        finishedAt: Date.now(),
        keptMessageCount: recentMessages.length,
        omittedBeforeCompression: initialContext.contextStats.omittedHistoryMessageCount,
        previousPromptTokens: initialContext.promptTokensEstimate,
        startedAt,
        summarizedMessageCount: olderMessages.length,
        summaryTokens: nextSummaryTokens
      } satisfies ContextCompressionResult,
      contextSummary: nextSummary,
      compressedHistoryMessageCount: nextCompressedMessageCount,
      previousMessages: recentMessages
    };
  } catch (error) {
    return {
      compression: {
        compressed: false,
        detail: "上下文压缩失败，已退回自动裁剪。",
        error: error instanceof Error ? error.message : String(error),
        finishedAt: Date.now(),
        keptMessageCount: liveMessages.length,
        omittedBeforeCompression: initialContext.contextStats.omittedHistoryMessageCount,
        previousPromptTokens: initialContext.promptTokensEstimate,
        startedAt,
        summarizedMessageCount: 0,
        summaryTokens: estimateTokens(existingSummary)
      } satisfies ContextCompressionResult,
      contextSummary: existingSummary,
      previousMessages: liveMessages
    };
  }
}
