import { prisma } from "@/lib/prisma";

const MAX_MEMORY_CONTENT_CHARS = 280;
const MAX_MEMORIES_PER_USER = 100;
const MAX_PROMPT_MEMORIES = 40;

const SENSITIVE_MEMORY_PATTERN =
  /(密码|口令|密钥|api\s*key|apikey|token|secret|验证码|身份证|银行卡|信用卡|私钥|助记词)/i;

type MemoryLike = {
  id: string;
  content: string;
  source: string;
  createdAt: Date;
  updatedAt: Date;
};

function cleanMemoryContent(value: string) {
  return value
    .replace(/^[：:，,\s]+/, "")
    .replace(/[。.!！?？\s]+$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_MEMORY_CONTENT_CHARS);
}

function normalizeMemoryKey(value: string) {
  return value.toLowerCase().replace(/\s+/g, "");
}

function isUsefulMemory(value: string) {
  return value.length >= 2 && !SENSITIVE_MEMORY_PATTERN.test(value);
}

function firstSentence(value: string) {
  return cleanMemoryContent(value.split(/[。.!！?？\n]/)[0] || value);
}

export function memoryToView(memory: MemoryLike) {
  return {
    id: memory.id,
    content: memory.content,
    source: memory.source,
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString()
  };
}

export async function listUserMemories(userId: string) {
  const memories = await prisma.userMemory.findMany({
    where: { userId },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: MAX_MEMORIES_PER_USER
  });

  return memories.map(memoryToView);
}

export async function createUserMemory({
  content,
  source = "manual",
  userId
}: {
  content: string;
  source?: string;
  userId: string;
}) {
  const cleaned = cleanMemoryContent(content);

  if (!isUsefulMemory(cleaned)) {
    throw new Error("记忆内容无效，或包含不适合保存的敏感信息。");
  }

  const existing = await prisma.userMemory.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: MAX_MEMORIES_PER_USER
  });
  const existingMemory = existing.find(
    (memory) => normalizeMemoryKey(memory.content) === normalizeMemoryKey(cleaned)
  );

  if (existingMemory) {
    return prisma.userMemory.update({
      where: { id: existingMemory.id },
      data: { source }
    });
  }

  const created = await prisma.userMemory.create({
    data: {
      content: cleaned,
      source,
      userId
    }
  });

  if (existing.length + 1 > MAX_MEMORIES_PER_USER) {
    const overflow = existing.slice(MAX_MEMORIES_PER_USER - 1);

    await prisma.userMemory.deleteMany({
      where: {
        id: { in: overflow.map((memory) => memory.id) },
        userId
      }
    });
  }

  return created;
}

export function formatMemoriesForPrompt(memories: Array<{ content: string }>) {
  const lines = memories
    .slice(0, MAX_PROMPT_MEMORIES)
    .map((memory) => cleanMemoryContent(memory.content))
    .filter(Boolean);

  if (lines.length === 0) {
    return "";
  }

  return `已保存记忆：\n${lines.map((line) => `- ${line}`).join("\n")}`;
}

function explicitRememberCandidates(message: string) {
  const candidates: string[] = [];
  const patterns = [
    {
      kind: "plain",
      pattern: /(?:请你?|帮我)?记住[：:，,\s]*(.+?)(?:[。.!！?？\n]|$)/gi
    },
    {
      kind: "name",
      pattern: /(?:以后|今后|之后)(?:请你?)?(?:叫|称呼)我[：:，,\s]*(.+?)(?:[。.!！?？\n]|$)/gi
    },
    {
      kind: "name",
      pattern: /我的(?:名字|昵称)是[：:，,\s]*(.+?)(?:[。.!！?？\n]|$)/gi
    },
    {
      kind: "name",
      pattern: /我叫[：:，,\s]*(.+?)(?:[。.!！?？\n]|$)/gi
    },
    {
      kind: "plain",
      pattern: /我(?:喜欢|偏好|不喜欢)[：:，,\s]*(.+?)(?:[。.!！?？\n]|$)/gi
    }
  ];

  for (const { kind, pattern } of patterns) {
    for (const match of message.matchAll(pattern)) {
      const raw = firstSentence(match[1] || "");

      if (!raw) {
        continue;
      }

      if (kind === "name") {
        candidates.push(`称呼用户为：${raw}`);
      } else {
        candidates.push(raw);
      }
    }
  }

  return [...new Set(candidates.map(cleanMemoryContent).filter(isUsefulMemory))];
}

function forgetRequest(message: string) {
  if (!/(忘记|不要记|别记|删除记忆|清除记忆)/.test(message)) {
    return null;
  }

  if (/(全部|所有|所有记忆|全部记忆)/.test(message)) {
    return { all: true, query: "" };
  }

  const match = message.match(
    /(?:忘记|不要记住?|不要记得?|别记住?|别记得?|删除记忆|清除记忆)[：:，,\s]*(.+?)(?:[。.!！?？\n]|$)/
  );

  return { all: false, query: cleanMemoryContent(match?.[1] || "") };
}

export async function applyMemoryInstructionsFromMessage({
  content,
  sourceMessageId,
  userId
}: {
  content: string;
  sourceMessageId?: string;
  userId: string;
}) {
  const forget = forgetRequest(content);

  if (forget?.all) {
    const deleted = await prisma.userMemory.deleteMany({ where: { userId } });

    return { created: 0, deleted: deleted.count };
  }

  if (forget?.query) {
    const memories = await prisma.userMemory.findMany({ where: { userId } });
    const queryKey = normalizeMemoryKey(forget.query);
    const matchedIds = memories
      .filter((memory) => normalizeMemoryKey(memory.content).includes(queryKey))
      .map((memory) => memory.id);

    if (matchedIds.length > 0) {
      const deleted = await prisma.userMemory.deleteMany({
        where: {
          id: { in: matchedIds },
          userId
        }
      });

      return { created: 0, deleted: deleted.count };
    }

    return { created: 0, deleted: 0 };
  }

  const candidates = explicitRememberCandidates(content);
  let created = 0;

  for (const candidate of candidates) {
    await createOrRefreshChatMemory({
      content: candidate,
      sourceMessageId,
      userId
    });
    created += 1;
  }

  return { created, deleted: 0 };
}

async function createOrRefreshChatMemory({
  content,
  sourceMessageId,
  userId
}: {
  content: string;
  sourceMessageId?: string;
  userId: string;
}) {
  const cleaned = cleanMemoryContent(content);

  if (!isUsefulMemory(cleaned)) {
    return null;
  }

  const existing = await prisma.userMemory.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: MAX_MEMORIES_PER_USER
  });
  const match = existing.find(
    (memory) => normalizeMemoryKey(memory.content) === normalizeMemoryKey(cleaned)
  );

  if (match) {
    return prisma.userMemory.update({
      where: { id: match.id },
      data: {
        source: "chat",
        sourceMessageId
      }
    });
  }

  return createUserMemory({
    content: cleaned,
    source: "chat",
    userId
  }).then((memory) =>
    sourceMessageId
      ? prisma.userMemory.update({
          where: { id: memory.id },
          data: { sourceMessageId }
        })
      : memory
  );
}
