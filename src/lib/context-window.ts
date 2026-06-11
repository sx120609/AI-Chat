import { capContextWindowTokens, type ChatModelConfig } from "@/lib/models";
import {
  estimateMessagesTokens,
  textFromMessageContent,
  type ChatMessageContent
} from "@/lib/tokens";

export type ContextMessage = {
  role: "system" | "user" | "assistant";
  content: ChatMessageContent;
};

export type ConversationHistoryMessage = {
  role: "USER" | "ASSISTANT";
  content: string;
};

export type ContextWindowStats = {
  promptTokensEstimate: number;
  historyMessageCount: number;
  omittedHistoryMessageCount: number;
  contextWindowTokens: number;
  longContextThresholdTokens: number;
  reserveTokens: number;
  longContextThresholdExceeded: boolean;
  contextWindowPercent: number;
  compressedHistoryMessageCount: number;
  compressedSummaryTokens: number;
};

const DEFAULT_REASONING_AND_OUTPUT_RESERVE_TOKENS = 25_000;

export function reserveTokensForModel(model: ChatModelConfig) {
  const contextWindowTokens = capContextWindowTokens(model.contextWindowTokens);

  if (contextWindowTokens <= 32_000) {
    return Math.max(2_000, Math.floor(contextWindowTokens * 0.2));
  }

  return Math.min(
    DEFAULT_REASONING_AND_OUTPUT_RESERVE_TOKENS,
    Math.floor(contextWindowTokens * 0.2)
  );
}

export function buildContextMessages(options: {
  compressedHistoryMessageCount?: number;
  contextSummary?: string;
  previousMessages: ConversationHistoryMessage[];
  systemPrompt: string;
  userContent?: ChatMessageContent;
  model: ChatModelConfig;
  longContextThresholdTokens: number;
}) {
  const contextSummary = options.contextSummary?.trim() || "";
  const userContentText = options.userContent ? textFromMessageContent(options.userContent) : "";
  const userMessages =
    options.userContent && userContentText.trim()
      ? [{ role: "user" as const, content: options.userContent }]
      : [];
  const summaryMessages: ContextMessage[] = contextSummary
    ? [
        {
          role: "system",
          content: `以下是较早对话的压缩摘要，用于延续上下文。摘要可能省略细节；如用户要求精确引用或原文，请说明需要重新提供原文。\n\n${contextSummary}`
        }
      ]
    : [];
  const fixedMessages: ContextMessage[] = [
    ...(options.systemPrompt
      ? [{ role: "system" as const, content: options.systemPrompt }]
      : []),
    ...summaryMessages,
    ...userMessages
  ];
  const contextWindowTokens = capContextWindowTokens(options.model.contextWindowTokens);
  const reserveTokens = reserveTokensForModel(options.model);
  const promptBudget = Math.max(1, contextWindowTokens - reserveTokens);
  const selectedReversed: ContextMessage[] = [];
  let totalTokens = estimateMessagesTokens(fixedMessages);

  for (const message of options.previousMessages) {
    const upstreamMessage: ContextMessage = {
      role: message.role === "ASSISTANT" ? "assistant" : "user",
      content: message.content
    };
    const nextTokens = estimateMessagesTokens([upstreamMessage]);

    if (totalTokens + nextTokens > promptBudget) {
      break;
    }

    selectedReversed.push(upstreamMessage);
    totalTokens += nextTokens;
  }

  const history = selectedReversed.reverse();
  const upstreamMessages: ContextMessage[] = [
    ...(options.systemPrompt
      ? [{ role: "system" as const, content: options.systemPrompt }]
      : []),
    ...summaryMessages,
    ...history,
    ...userMessages
  ];
  const compressedSummaryTokens = estimateMessagesTokens(summaryMessages);
  const promptTokensEstimate = estimateMessagesTokens(upstreamMessages);
  const contextStats: ContextWindowStats = {
    promptTokensEstimate,
    historyMessageCount: history.length,
    omittedHistoryMessageCount: Math.max(0, options.previousMessages.length - history.length),
    contextWindowTokens,
    longContextThresholdTokens: options.longContextThresholdTokens,
    reserveTokens,
    longContextThresholdExceeded: promptTokensEstimate >= options.longContextThresholdTokens,
    contextWindowPercent: Math.min(
      100,
      Math.round((promptTokensEstimate / contextWindowTokens) * 100)
    ),
    compressedHistoryMessageCount: options.compressedHistoryMessageCount ?? 0,
    compressedSummaryTokens
  };

  return {
    upstreamMessages,
    promptTokensEstimate,
    contextStats
  };
}
