import { type ChatModelConfig } from "@/lib/models";
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
};

const DEFAULT_REASONING_AND_OUTPUT_RESERVE_TOKENS = 25_000;

export function reserveTokensForModel(model: ChatModelConfig) {
  if (model.contextWindowTokens <= 32_000) {
    return Math.max(2_000, Math.floor(model.contextWindowTokens * 0.2));
  }

  return Math.min(
    DEFAULT_REASONING_AND_OUTPUT_RESERVE_TOKENS,
    Math.floor(model.contextWindowTokens * 0.2)
  );
}

export function buildContextMessages(options: {
  previousMessages: ConversationHistoryMessage[];
  systemPrompt: string;
  userContent?: ChatMessageContent;
  model: ChatModelConfig;
  longContextThresholdTokens: number;
}) {
  const userContentText = options.userContent ? textFromMessageContent(options.userContent) : "";
  const userMessages =
    options.userContent && userContentText.trim()
      ? [{ role: "user" as const, content: options.userContent }]
      : [];
  const fixedMessages: ContextMessage[] = [
    ...(options.systemPrompt
      ? [{ role: "system" as const, content: options.systemPrompt }]
      : []),
    ...userMessages
  ];
  const reserveTokens = reserveTokensForModel(options.model);
  const promptBudget = Math.max(1, options.model.contextWindowTokens - reserveTokens);
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
    ...history,
    ...userMessages
  ];
  const promptTokensEstimate = estimateMessagesTokens(upstreamMessages);
  const contextStats: ContextWindowStats = {
    promptTokensEstimate,
    historyMessageCount: history.length,
    omittedHistoryMessageCount: Math.max(0, options.previousMessages.length - history.length),
    contextWindowTokens: options.model.contextWindowTokens,
    longContextThresholdTokens: options.longContextThresholdTokens,
    reserveTokens,
    longContextThresholdExceeded: promptTokensEstimate >= options.longContextThresholdTokens,
    contextWindowPercent: Math.min(
      100,
      Math.round((promptTokensEstimate / options.model.contextWindowTokens) * 100)
    )
  };

  return {
    upstreamMessages,
    promptTokensEstimate,
    contextStats
  };
}
