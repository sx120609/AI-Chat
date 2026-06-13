import { prisma } from "@/lib/prisma";

const MAX_MEMORY_CONTENT_CHARS = 280;
const MAX_MEMORIES_PER_USER = 100;
const MAX_PROMPT_MEMORIES = 40;

const SENSITIVE_MEMORY_PATTERN =
  /(密码|口令|密钥|api\s*key|apikey|token|secret|验证码|身份证|银行卡|信用卡|私钥|助记词)/i;
const CONVERSATION_UTTERANCE_MEMORY_PATTERN =
  /^(?:我说|用户说|用户曾说|他说|她说)[：:，,\s“"']*(?:我是你的|我是你|你是我的|你是我)/i;

type MemoryLike = {
  id: string;
  content: string;
  project?: {
    name: string;
  } | null;
  projectId?: string | null;
  source: string;
  archivedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MemoryToolDecision = {
  action: "none" | "remember" | "forget";
  all?: boolean;
  items?: string[];
  query?: string;
  reason?: string;
};

export type MemoryApplyResult = {
  action: MemoryToolDecision["action"];
  created: number;
  deleted: number;
  detail: string;
  error?: string;
  finishedAt: number;
  skipped: boolean;
  startedAt: number;
};

export const NO_MEMORY_DECISION: MemoryToolDecision = {
  action: "none",
  reason: "本条消息不需要更新长期记忆。"
};

function cleanMemoryContent(value: string) {
  return value
    .replace(/^[：:，,\s]+/, "")
    .replace(/[。.!！?？\s]+$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_MEMORY_CONTENT_CHARS);
}

function extractCallNamePreference(value: string) {
  const cleaned = cleanMemoryContent(value).replace(/[“”"']/g, "");
  const patterns = [
    /(?:称呼|叫)(?:用户|我)(?:为|作|做)?[：:，,\s]*(.+)$/i,
    /(?:用户|我)(?:希望|想要|要求|以后要你?|以后希望你?|之后请你?|今后请你?)(?:叫|称呼)(?:用户|我)?(?:为|作|做)?[：:，,\s]*(.+)$/i,
    /(?:以后|今后|之后)(?:每次)?(?:跟我说话)?(?:都)?(?:要|先)?(?:叫|称呼)(?:我|用户)?(?:为|作|做)?[：:，,\s]*(.+)$/i,
    /(?:我的|用户的)(?:昵称|称呼|名字)(?:是|为)[：:，,\s]*(.+)$/i
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    const name = cleanMemoryContent((match?.[1] || "").split(/[，,。.!！?？；;\n]/)[0] || "")
      .replace(/^[“”"']+|[“”"']+$/g, "");

    if (name && name.length <= 40) {
      return name;
    }
  }

  return null;
}

function normalizeMemoryContentForStorage(value: string) {
  const cleaned = cleanMemoryContent(value);
  const callName = extractCallNamePreference(cleaned);

  return callName ? `称呼用户为：${callName}` : cleaned;
}

function isLikelyConversationUtteranceMemory(value: string) {
  return CONVERSATION_UTTERANCE_MEMORY_PATTERN.test(cleanMemoryContent(value));
}

function normalizeMemoryKey(value: string) {
  return value.toLowerCase().replace(/\s+/g, "");
}

function isUsefulMemory(value: string) {
  return (
    value.length >= 2 &&
    !SENSITIVE_MEMORY_PATTERN.test(value) &&
    !isLikelyConversationUtteranceMemory(value)
  );
}

export function prepareMemoryContentForStorage(value: string) {
  const cleaned = normalizeMemoryContentForStorage(value);

  if (!isUsefulMemory(cleaned)) {
    throw new Error("记忆内容无效，或包含不适合保存的敏感信息。");
  }

  return cleaned;
}

export function memoryHasCallNamePreference(value: string) {
  return Boolean(extractCallNamePreference(value));
}

function firstSentence(value: string) {
  return cleanMemoryContent(value.split(/[。.!！?？\n]/)[0] || value);
}

export function normalizeMemoryDecision(decision: unknown): MemoryToolDecision {
  if (!decision || typeof decision !== "object") {
    return NO_MEMORY_DECISION;
  }

  const source = decision as Record<string, unknown>;
  const actionValue =
    typeof source.action === "string"
      ? source.action
      : typeof source.type === "string"
        ? source.type
        : "";
  const action = /remember|save|create|add|记住|保存/i.test(actionValue)
    ? "remember"
    : /forget|delete|clear|remove|忘记|删除|清除/i.test(actionValue)
      ? "forget"
      : "none";
  const reason = cleanMemoryContent(typeof source.reason === "string" ? source.reason : "");

  if (action === "remember") {
    const rawItems = Array.isArray(source.items)
      ? source.items
      : Array.isArray(source.memories)
        ? source.memories
        : typeof source.content === "string" || typeof source.memory === "string"
          ? [source.content ?? source.memory]
          : [];
    const items = [...new Set(rawItems.map((item) => cleanMemoryContent(String(item))).filter(isUsefulMemory))]
      .slice(0, 3);

    if (items.length === 0) {
      return NO_MEMORY_DECISION;
    }

    return {
      action,
      items,
      reason: reason || "AI 判断本条消息包含可长期使用的用户偏好或事实。"
    };
  }

  if (action === "forget") {
    const all = source.all === true || source.scope === "all";
    const query = cleanMemoryContent(
      typeof source.query === "string"
        ? source.query
        : typeof source.content === "string"
          ? source.content
          : ""
    );

    if (!all && !query) {
      return NO_MEMORY_DECISION;
    }

    return {
      action,
      all,
      query,
      reason: reason || (all ? "用户要求清空记忆。" : "用户要求删除相关记忆。")
    };
  }

  return reason ? { ...NO_MEMORY_DECISION, reason } : NO_MEMORY_DECISION;
}

export function memoryToView(memory: MemoryLike) {
  return {
    id: memory.id,
    content: memory.content,
    projectId: memory.projectId ?? null,
    projectName: memory.project?.name ?? null,
    source: memory.source,
    archivedAt: memory.archivedAt ? memory.archivedAt.toISOString() : null,
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString()
  };
}

export async function listUserMemories(
  userId: string,
  options: {
    includeArchived?: boolean;
    includeProjects?: boolean;
    projectId?: string | null;
  } = {}
) {
  const memories = await prisma.userMemory.findMany({
    where: {
      userId,
      ...(options.includeProjects ? {} : { projectId: options.projectId ?? null }),
      ...(options.includeArchived ? {} : { archivedAt: null })
    },
    include: {
      project: {
        select: { name: true }
      }
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: MAX_MEMORIES_PER_USER
  });

  return memories.map(memoryToView);
}

export async function createUserMemory({
  content,
  projectId = null,
  source = "manual",
  userId
}: {
  content: string;
  projectId?: string | null;
  source?: string;
  userId: string;
}) {
  const cleaned = prepareMemoryContentForStorage(content);
  const callName = extractCallNamePreference(cleaned);

  const existing = await prisma.userMemory.findMany({
    where: { userId, projectId },
    orderBy: { updatedAt: "desc" },
    take: MAX_MEMORIES_PER_USER
  });
  const existingMemory = existing.find(
    (memory) => normalizeMemoryKey(memory.content) === normalizeMemoryKey(cleaned)
  );

  if (callName) {
    const conflictingCallNameIds = existing
      .filter((memory) => memory.id !== existingMemory?.id && extractCallNamePreference(memory.content))
      .map((memory) => memory.id);

    if (conflictingCallNameIds.length > 0) {
      await prisma.userMemory.updateMany({
        where: {
          id: { in: conflictingCallNameIds },
          projectId,
          userId
        },
        data: {
          archivedAt: new Date()
        }
      });
    }
  }

  if (existingMemory) {
    return prisma.userMemory.update({
      where: { id: existingMemory.id },
      data: { archivedAt: null, content: cleaned, source }
    });
  }

  const created = await prisma.userMemory.create({
    data: {
      content: cleaned,
      projectId,
      source,
      userId
    }
  });

  if (existing.length + 1 > MAX_MEMORIES_PER_USER) {
    const overflow = existing.slice(MAX_MEMORIES_PER_USER - 1);

    await prisma.userMemory.deleteMany({
      where: {
        id: { in: overflow.map((memory) => memory.id) },
        projectId,
        userId
      }
    });
  }

  return created;
}

export function formatMemoriesForPrompt(
  memories: Array<{ content: string }>,
  options: {
    profileNickname?: string;
  } = {}
) {
  const lines: string[] = [];
  const profileNickname = cleanMemoryContent(options.profileNickname || "");
  let callNameLine = "";

  for (const memory of memories) {
    const content = cleanMemoryContent(memory.content);

    if (!content || isLikelyConversationUtteranceMemory(content)) {
      continue;
    }

    const callName = extractCallNamePreference(content);

    if (callName) {
      if (!profileNickname && !callNameLine) {
        callNameLine = `称呼用户为：${callName}`;
      }

      continue;
    }

    lines.push(content);

    if (lines.length >= MAX_PROMPT_MEMORIES) {
      break;
    }
  }

  if (callNameLine) {
    lines.unshift(callNameLine);
  }

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

export function fallbackMemoryDecisionFromMessage(message: string): MemoryToolDecision {
  const forget = forgetRequest(message);

  if (forget?.all) {
    return {
      action: "forget",
      all: true,
      reason: "用户明确要求清空记忆。"
    };
  }

  if (forget?.query) {
    return {
      action: "forget",
      query: forget.query,
      reason: "用户明确要求删除相关记忆。"
    };
  }

  const candidates = explicitRememberCandidates(message);

  if (candidates.length > 0) {
    return {
      action: "remember",
      items: candidates,
      reason: "用户明确表达了需要记住的内容。"
    };
  }

  return NO_MEMORY_DECISION;
}

export async function applyMemoryDecision({
  decision,
  projectId = null,
  sourceMessageId,
  userId
}: {
  decision: MemoryToolDecision;
  projectId?: string | null;
  sourceMessageId?: string;
  userId: string;
}): Promise<MemoryApplyResult | null> {
  const normalized = normalizeMemoryDecision(decision);

  if (normalized.action === "none") {
    return null;
  }

  const startedAt = Date.now();

  try {
    if (normalized.action === "forget") {
      if (normalized.all) {
        const deleted = await prisma.userMemory.deleteMany({ where: { projectId, userId } });

        return {
          action: normalized.action,
          created: 0,
          deleted: deleted.count,
          detail:
            deleted.count > 0
              ? `已清空 ${deleted.count} 条保存的记忆`
              : "没有可清空的保存记忆",
          finishedAt: Date.now(),
          skipped: deleted.count === 0,
          startedAt
        };
      }

      const query = cleanMemoryContent(normalized.query || "");

      if (!query) {
        return {
          action: normalized.action,
          created: 0,
          deleted: 0,
          detail: "AI 判断需要删除记忆，但没有给出可匹配内容",
          finishedAt: Date.now(),
          skipped: true,
          startedAt
        };
      }

      const memories = await prisma.userMemory.findMany({ where: { projectId, userId } });
      const queryKey = normalizeMemoryKey(query);
      const matchedIds = memories
        .filter((memory) => normalizeMemoryKey(memory.content).includes(queryKey))
        .map((memory) => memory.id);

      if (matchedIds.length === 0) {
        return {
          action: normalized.action,
          created: 0,
          deleted: 0,
          detail: `没有找到匹配“${query}”的保存记忆`,
          finishedAt: Date.now(),
          skipped: true,
          startedAt
        };
      }

      const deleted = await prisma.userMemory.deleteMany({
        where: {
          id: { in: matchedIds },
          projectId,
          userId
        }
      });

      return {
        action: normalized.action,
        created: 0,
        deleted: deleted.count,
        detail: `已删除 ${deleted.count} 条匹配“${query}”的记忆`,
        finishedAt: Date.now(),
        skipped: deleted.count === 0,
        startedAt
      };
    }

    let created = 0;

    for (const item of normalized.items ?? []) {
      const memory = await createOrRefreshChatMemory({
        content: item,
        projectId,
        sourceMessageId,
        userId
      });

      if (memory) {
        created += 1;
      }
    }

    return {
      action: normalized.action,
      created,
      deleted: 0,
      detail:
        created > 0
          ? `已保存/更新 ${created} 条长期记忆`
          : "AI 判断需要保存记忆，但内容不适合长期保存",
      finishedAt: Date.now(),
      skipped: created === 0,
      startedAt
    };
  } catch (error) {
    return {
      action: normalized.action,
      created: 0,
      deleted: 0,
      detail: "记忆更新失败",
      error: error instanceof Error ? error.message : String(error),
      finishedAt: Date.now(),
      skipped: false,
      startedAt
    };
  }
}

async function createOrRefreshChatMemory({
  content,
  projectId = null,
  sourceMessageId,
  userId
}: {
  content: string;
  projectId?: string | null;
  sourceMessageId?: string;
  userId: string;
}) {
  let cleaned: string;

  try {
    cleaned = prepareMemoryContentForStorage(content);
  } catch {
    return null;
  }

  const callName = extractCallNamePreference(cleaned);

  const existing = await prisma.userMemory.findMany({
    where: { userId, projectId },
    orderBy: { updatedAt: "desc" },
    take: MAX_MEMORIES_PER_USER
  });
  const match = existing.find(
    (memory) => normalizeMemoryKey(memory.content) === normalizeMemoryKey(cleaned)
  );

  if (match) {
    if (callName) {
      const conflictingCallNameIds = existing
        .filter((memory) => memory.id !== match.id && extractCallNamePreference(memory.content))
        .map((memory) => memory.id);

      if (conflictingCallNameIds.length > 0) {
        await prisma.userMemory.updateMany({
          where: {
            id: { in: conflictingCallNameIds },
            projectId,
            userId
          },
          data: {
            archivedAt: new Date()
          }
        });
      }
    }

    return prisma.userMemory.update({
      where: { id: match.id },
      data: {
        archivedAt: null,
        source: "chat",
        sourceMessageId
      }
    });
  }

  return createUserMemory({
    content: cleaned,
    projectId,
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
