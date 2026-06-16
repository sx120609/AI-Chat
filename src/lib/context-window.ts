import type { ChatModelConfig } from "@/lib/models";
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
  contextWindowTokens: number;
  reserveTokens: number;
};

export function reserveTokensForModel(model: ChatModelConfig) {
  void model;
  return 0;
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
      content: message.content
    }));
  const upstreamMessages: ContextMessage[] = [
    ...(options.systemPrompt
      ? [{ role: "system" as const, content: options.systemPrompt }]
      : []),
    ...history,
    ...userMessages
  ];
  const reserveTokens = reserveTokensForModel(options.model);
  const promptTokensEstimate = estimateMessagesTokens(upstreamMessages);
  const contextWindowTokens = Math.max(options.model.contextWindowTokens, promptTokensEstimate);
  const contextStats: ContextWindowStats = {
    promptTokensEstimate,
    historyMessageCount: history.length,
    contextWindowTokens,
    reserveTokens
  };

  return {
    upstreamMessages,
    promptTokensEstimate,
    contextStats
  };
}
