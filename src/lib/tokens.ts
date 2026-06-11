export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatMessageContent = string | ChatContentPart[];

type ChatMessage = {
  role: string;
  content: ChatMessageContent;
};

export function estimateTokens(text: string) {
  if (!text.trim()) {
    return 0;
  }

  const ascii = text.match(/[\x00-\x7F]/g)?.length ?? 0;
  const nonAscii = text.length - ascii;

  return Math.max(1, Math.ceil(ascii / 4 + nonAscii));
}

export function textFromMessageContent(content: ChatMessageContent) {
  if (typeof content === "string") {
    return content;
  }

  return content
    .map((part) => (part.type === "text" ? part.text : "[image]"))
    .join("\n");
}

export function estimateMessagesTokens(messages: ChatMessage[]) {
  return messages.reduce(
    (total, message) => total + estimateTokens(textFromMessageContent(message.content)) + 6,
    0
  );
}

export function compactTitle(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "New chat";
  }

  return normalized.length > 36 ? `${normalized.slice(0, 36)}...` : normalized;
}
