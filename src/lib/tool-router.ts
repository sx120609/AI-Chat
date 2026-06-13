import {
  createResponseText,
  type AiRuntimeSettings,
  type UpstreamMessage
} from "@/lib/upstream";
import { LIGHTWEIGHT_TASK_MODEL_ID } from "@/lib/models";
import {
  fallbackMemoryDecisionFromMessage,
  normalizeMemoryDecision,
  NO_MEMORY_DECISION,
  type MemoryToolDecision
} from "@/lib/memories";
import { normalizePromptClock, type PromptClock } from "@/lib/system-prompt";
import { shouldUseWebSearch } from "@/lib/web-search";

export type ToolRoutePlan = {
  memory: MemoryToolDecision;
  query: string;
  reason: string;
  shouldSearch: boolean;
  tool: "chat" | "image";
};

const MAX_ROUTER_RESPONSE_CHARS = 4000;
const EXPLICIT_SEARCH_PATTERN = /(联网|搜索|查一下|查找|检索|搜一下|网上|网络|web search|search the web|duckduckgo)/i;
const ATTACHMENT_BOUND_PATTERN =
  /(这|这个|这份|这张|它|附件|文件|文档|pdf|表格|图片|截图|报告|内容|里面|上面|是什么|总结|概括|分析|解读|翻译|提取|what is this|this file|attached file)/i;
const IMAGE_CREATION_PATTERN =
  /(生图|生成图片|生成一张|画一张|画个|画幅|出图|绘制|设计.{0,12}(图|图片|海报|头像|logo|壁纸|封面|插画|表情包)|做.{0,12}(图|图片|海报|头像|logo|壁纸|封面|插画|表情包)|visualize|render|draw|generate an image|create an image|make an image|illustration|poster|logo|wallpaper)/i;
const IMAGE_ANALYSIS_PATTERN =
  /(分析|识别|解释|总结|提取|翻译|读取|看一下|这是什么|describe|analyze|extract|ocr|summari[sz]e|explain)/i;
const VAGUE_QUERY_PATTERN =
  /^(这|这个|这是什么|它|这个文件|这份文件|此文件|附件|文件|文档|pdf|what is this|this|it)$/i;
const QUERY_ENTITY_ALIASES: Array<[RegExp, string]> = [
  [/特朗普/i, "Trump"],
  [/拜登/i, "Biden"],
  [/马斯克/i, "Musk"],
  [/欧盟/i, "EU"]
];
const QUERY_TOPIC_ALIASES: Array<[RegExp, string]> = [
  [/政策/i, "policy"],
  [/关税/i, "tariff"],
  [/移民/i, "immigration"],
  [/制裁/i, "sanctions"]
];

function jsonFromRouterResponse(text: string) {
  const trimmed = text.trim().slice(0, MAX_ROUTER_RESPONSE_CHARS);
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || trimmed;

  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");

    if (start < 0 || end <= start) {
      return null;
    }

    try {
      return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function explicitlyRequestsSearch(prompt: string) {
  return EXPLICIT_SEARCH_PATTERN.test(prompt);
}

function isAttachmentBoundPrompt(prompt: string, attachmentCount: number) {
  return attachmentCount > 0 && !explicitlyRequestsSearch(prompt) && ATTACHMENT_BOUND_PATTERN.test(prompt);
}

function hasSearchableQuery(value: string) {
  const normalized = value
    .replace(/[，,。？?！!\s]+/g, "")
    .trim()
    .toLowerCase();

  if (!normalized || VAGUE_QUERY_PATTERN.test(normalized)) {
    return false;
  }

  if (/^[\u4e00-\u9fff]$/.test(normalized)) {
    return false;
  }

  return /[\u4e00-\u9fff]{2,}|[a-z0-9][a-z0-9.+#-]{1,}/i.test(value);
}

function fallbackQuery(prompt: string) {
  const query = prompt
    .replace(/^(请|帮我|麻烦你|能不能|可以|请问)?(联网|搜索|查一下|查找|检索|搜一下)/, "")
    .replace(/^(请|帮我|麻烦你|能不能|可以|请问)(我)?/, "")
    .replace(/[。！？!?]+$/g, "")
    .trim()
    .slice(0, 120);
  const aliases = QUERY_ENTITY_ALIASES.flatMap(([pattern, alias]) =>
    pattern.test(query) && !query.toLowerCase().includes(alias.toLowerCase()) ? [alias] : []
  );
  const topicAliases = QUERY_TOPIC_ALIASES.flatMap(([pattern, alias]) =>
    pattern.test(query) && !query.toLowerCase().includes(alias.toLowerCase()) ? [alias] : []
  );

  return [...aliases, ...topicAliases, query].join(" ").trim();
}

function likelyImagePrompt(options: {
  attachmentCount: number;
  hasImageAttachment: boolean;
  imageToolRequested: boolean;
  prompt: string;
  sourceImageSelected: boolean;
}) {
  if (options.sourceImageSelected || options.imageToolRequested) {
    return true;
  }

  if (options.hasImageAttachment && IMAGE_CREATION_PATTERN.test(options.prompt)) {
    return true;
  }

  if (options.hasImageAttachment && IMAGE_ANALYSIS_PATTERN.test(options.prompt)) {
    return false;
  }

  return IMAGE_CREATION_PATTERN.test(options.prompt);
}

function fallbackPlan(options: {
  attachmentCount: number;
  forceSearch: boolean;
  hasImageAttachment: boolean;
  imageToolRequested: boolean;
  memoryEnabled: boolean;
  prompt: string;
  sourceImageSelected: boolean;
}) {
  const tool = likelyImagePrompt(options) ? "image" : "chat";
  const attachmentBound = isAttachmentBoundPrompt(options.prompt, options.attachmentCount);
  const query = fallbackQuery(options.prompt);
  const shouldSearch =
    tool === "chat" &&
    !attachmentBound &&
    hasSearchableQuery(query) &&
    (options.forceSearch || shouldUseWebSearch(options.prompt));

  return {
    memory: options.memoryEnabled
      ? fallbackMemoryDecisionFromMessage(options.prompt)
      : NO_MEMORY_DECISION,
    query,
    reason: tool === "image" ? "fallback-image-intent" : "fallback-chat-intent",
    shouldSearch,
    tool
  } satisfies ToolRoutePlan;
}

function normalizePlan(
  value: Record<string, unknown> | null,
  fallback: ToolRoutePlan,
  options: { memoryEnabled: boolean }
) {
  if (!value) {
    return fallback;
  }

  const tool = value.tool === "image" ? "image" : "chat";
  const query = typeof value.query === "string" ? value.query.trim().slice(0, 160) : fallback.query;
  const reason = typeof value.reason === "string" ? value.reason.trim().slice(0, 240) : "";
  const shouldSearch =
    tool === "chat" &&
    (typeof value.shouldSearch === "boolean"
      ? value.shouldSearch
      : typeof value.should_search === "boolean"
        ? value.should_search
        : fallback.shouldSearch) &&
    hasSearchableQuery(query);
  const memory = options.memoryEnabled
    ? normalizeMemoryDecision(value.memory ?? value.memoryDecision ?? value.memory_decision)
    : NO_MEMORY_DECISION;
  const resolvedMemory =
    memory.action === "none" && fallback.memory.action !== "none" ? fallback.memory : memory;

  return {
    memory: resolvedMemory,
    query,
    reason: reason || fallback.reason,
    shouldSearch,
    tool
  } satisfies ToolRoutePlan;
}

function buildRouterMessages(options: {
  attachmentCount: number;
  forceSearch: boolean;
  hasImageAttachment: boolean;
  imageToolRequested: boolean;
  memoryEnabled: boolean;
  prompt: string;
  promptClock?: Partial<PromptClock>;
  sourceImageSelected: boolean;
}): UpstreamMessage[] {
  const promptClock = normalizePromptClock(options.promptClock);

  return [
    {
      role: "system",
      content:
        "你是工具路由器，不回答用户问题，只判断本条消息应该调用哪些工具。只返回 JSON，不要 Markdown，不要解释。JSON 必须是 {\"tool\":\"chat\"|\"image\",\"shouldSearch\":true|false,\"query\":\"搜索词\",\"reason\":\"一句话原因\",\"memory\":{\"action\":\"none\"|\"remember\"|\"forget\",\"items\":[\"要保存的记忆\"],\"query\":\"要删除的记忆关键词\",\"all\":false,\"reason\":\"一句话原因\"}}。tool=image 表示用户想生成、绘制、设计、编辑或变换图片、海报、头像、logo、壁纸、封面、插画、表情包、视觉稿、构图或让模型输出新图。用户上传/选中了图片并要求修改、重绘、换风格、扩展、基于它生成，也选 image。用户只是问图片/附件里有什么、要求识别、总结、翻译、OCR、分析截图或文档，选 chat。image 工具不联网，shouldSearch 必须 false。tool=chat 时，再判断是否需要联网：当前/最新/价格/天气/政策/版本/新闻/赛程等可能变化的信息或用户明确要求联网时 shouldSearch=true；常识、写作、翻译、代码解释、附件总结等 shouldSearch=false。强制搜索=是时，只要 tool=chat 且问题有可搜索主题，shouldSearch=true。搜索词要保留关键实体、地点、时间、政策/价格/版本等限定词，不要只保留“这/这个/它”。记忆开关=关时 memory.action 必须为 none。记忆开关=开时，只在用户明确要求记住/忘记，或消息包含长期稳定、未来多次有用的用户偏好、称呼、工作方式、个人事实时保存记忆；不要保存一次性任务、临时话题、普通聊天内容、搜索问题、附件内容摘要、密码、密钥、token、验证码、身份证、银行卡、私钥等敏感信息。保存时把 items 写成第一人称事实或偏好，每条不超过 80 字；删除时用 forget，all=true 表示清空全部记忆，否则给 query。"
    },
    {
      role: "user",
      content: `当前日期：${promptClock.date}\n当前时间：${promptClock.time}（${promptClock.timeZone}）\n强制搜索：${options.forceSearch ? "是" : "否"}\n记忆开关：${options.memoryEnabled ? "开" : "关"}\n用户点了生图工具：${options.imageToolRequested ? "是" : "否"}\n已选择待编辑源图片：${options.sourceImageSelected ? "是" : "否"}\n本条消息附件数：${options.attachmentCount}\n附件里有图片：${options.hasImageAttachment ? "是" : "否"}\n用户消息：${options.prompt}`
    }
  ];
}

export async function planMessageTools(options: {
  attachmentCount?: number;
  forceSearch?: boolean;
  hasImageAttachment?: boolean;
  imageToolRequested?: boolean;
  memoryEnabled?: boolean;
  prompt: string;
  promptClock?: Partial<PromptClock>;
  settings: AiRuntimeSettings;
  signal?: AbortSignal;
  sourceImageSelected?: boolean;
}): Promise<ToolRoutePlan> {
  const fallback = fallbackPlan({
    attachmentCount: options.attachmentCount ?? 0,
    forceSearch: Boolean(options.forceSearch),
    hasImageAttachment: Boolean(options.hasImageAttachment),
    imageToolRequested: Boolean(options.imageToolRequested),
    memoryEnabled: Boolean(options.memoryEnabled),
    prompt: options.prompt,
    sourceImageSelected: Boolean(options.sourceImageSelected)
  });

  if (options.settings.mockResponses) {
    return fallback;
  }

  try {
    const routerText = await createResponseText(
      LIGHTWEIGHT_TASK_MODEL_ID,
      buildRouterMessages({
        attachmentCount: options.attachmentCount ?? 0,
        forceSearch: Boolean(options.forceSearch),
        hasImageAttachment: Boolean(options.hasImageAttachment),
        imageToolRequested: Boolean(options.imageToolRequested),
        memoryEnabled: Boolean(options.memoryEnabled),
        prompt: options.prompt,
        promptClock: options.promptClock,
        sourceImageSelected: Boolean(options.sourceImageSelected)
      }),
      options.settings,
      { allowDisabledModel: true, signal: options.signal }
    );

    return normalizePlan(jsonFromRouterResponse(routerText), fallback, {
      memoryEnabled: Boolean(options.memoryEnabled)
    });
  } catch (error) {
    console.warn(
      "[tool-router] Failed to plan tools:",
      error instanceof Error ? error.message : error
    );
    return fallback;
  }
}
