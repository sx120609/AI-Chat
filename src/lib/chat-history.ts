import { prisma } from "@/lib/prisma";

const MAX_HISTORY_CONVERSATIONS = 6;
const MAX_MESSAGES_PER_CONVERSATION = 4;
const MAX_MESSAGE_CHARS = 180;
const MAX_PROMPT_CHARS = 1600;

function compactText(value: string, maxLength = MAX_MESSAGE_CHARS) {
  const cleaned = value.replace(/\s+/g, " ").trim();

  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  return `${cleaned.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export async function formatRecentChatHistoryForPrompt({
  excludeConversationId,
  projectId,
  userId
}: {
  excludeConversationId?: string | null;
  projectId?: string | null;
  userId: string;
}) {
  const conversations = await prisma.conversation.findMany({
    where: {
      userId,
      archivedAt: null,
      mode: "CHAT",
      ...(excludeConversationId ? { id: { not: excludeConversationId } } : {}),
      ...(projectId ? { projectId } : {})
    },
    include: {
      messages: {
        where: {
          imageUrl: null,
          role: {
            in: ["USER", "ASSISTANT"]
          }
        },
        orderBy: {
          createdAt: "desc"
        },
        take: MAX_MESSAGES_PER_CONVERSATION
      }
    },
    orderBy: {
      updatedAt: "desc"
    },
    take: MAX_HISTORY_CONVERSATIONS
  });

  const sections: string[] = [];
  let usedChars = 0;

  for (const conversation of conversations) {
    const messages = conversation.messages
      .slice()
      .reverse()
      .map((message) => {
        const content = compactText(message.content);

        if (!content) {
          return "";
        }

        return `${message.role === "USER" ? "用户" : "AI"}：${content}`;
      })
      .filter(Boolean);

    if (messages.length === 0) {
      continue;
    }

    const title = compactText(conversation.title || "未命名会话", 60);
    const section = [`- ${title}（${formatDate(conversation.updatedAt)}）`, ...messages].join("\n");

    if (usedChars + section.length > MAX_PROMPT_CHARS) {
      break;
    }

    sections.push(section);
    usedChars += section.length;
  }

  if (sections.length === 0) {
    return "";
  }

  return [
    "可参考的近期聊天历史（用户开启“引用聊天历史”时提供；只作为背景，除非相关不要复述）：",
    sections.join("\n")
  ].join("\n");
}
