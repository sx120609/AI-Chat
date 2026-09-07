import type { ChatModelConfig } from "@/lib/models";
import type { ResponseItem } from "./responses-state";
import {
  estimateMessagesTokens,
  textFromMessageContent,
  type ChatMessageContent
} from "@/lib/tokens";

export type ContextMessage = {
  role: "system" | "user" | "assistant";
  content: ChatMessageContent;
  responseItems?: ResponseItem[];
  responseScope?: string;
};

export type ConversationHistoryMessage = {
  role: "USER" | "ASSISTANT";
  content: string;
  responseItems?: ResponseItem[];
  responseScope?: string;
};

export type ContextWindowStats = {
  promptTokensEstimate: number;
  historyMessageCount: number;
  contextWindowTokens: number;
  reserveTokens: number;
  omittedMessageCount?: number;
};

export function reserveTokensForModel(model: ChatModelConfig) {
  return Math.min(16384, Math.max(2048, Math.floor(model.contextWindowTokens * 0.12)));
}

export function buildContextMessages(options: {
  previousMessages: ConversationHistoryMessage[];
  systemPrompt: string;
  userContent?: ChatMessageContent;
  model: ChatModelConfig;
}) {
  const userContentText = options.userContent ? textFromMessageContent(options.userContent) : "";
  const userMessages =
    options.userContent && userContentText.trim()
      ? [{ role: "user" as const, content: options.userContent }]
      : [];
  const history = options.previousMessages
    .slice()
    .reverse()
    .map<ContextMessage>((message) => ({
      role: message.role === "ASSISTANT" ? "assistant" : "user",
      content: message.content,
      responseItems: message.responseItems,
      responseScope: message.responseScope
    }));
  const reserveTokens = reserveTokensForModel(options.model);
  const budget = Math.max(1, options.model.contextWindowTokens - reserveTokens);
  const fixed: ContextMessage[] = [
    ...(options.systemPrompt
      ? [{ role: "system" as const, content: options.systemPrompt }]
      : []),
    ...userMessages
  ];
  const messageCost = (message: ContextMessage) => estimateMessagesTokens([message]) + (message.responseItems?.length ? Math.ceil(JSON.stringify(message.responseItems).length / 3) : 0);
  let historyCost = history.reduce((sum, message) => sum + messageCost(message), 0);
  const fixedCost = estimateMessagesTokens(fixed);
  let omittedMessageCount = 0;
  while (history.length && fixedCost + historyCost > budget) {
    historyCost -= messageCost(history.shift()!);
    omittedMessageCount++;
    while (history[0]?.role === "assistant") {
      historyCost -= messageCost(history.shift()!);
      omittedMessageCount++;
    }
  }
  if (fixedCost > budget) throw new Error("本次输入超过模型上下文容量，请缩小文件或拆分任务。");
  const upstreamMessages: ContextMessage[] = [
    ...fixed.filter(message => message.role === "system"),
    ...history, ...userMessages
  ];
  const promptTokensEstimate = estimateMessagesTokens(upstreamMessages);
  const contextWindowTokens = options.model.contextWindowTokens;
  const contextStats: ContextWindowStats = {
    promptTokensEstimate,
    historyMessageCount: history.length,
    contextWindowTokens,
    reserveTokens,
    omittedMessageCount
  };

  return {
    upstreamMessages,
    promptTokensEstimate,
    contextStats
  };
}
