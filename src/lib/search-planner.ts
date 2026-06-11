import {
  createChatCompletionText,
  type AiRuntimeSettings,
  type UpstreamChatMessage
} from "@/lib/upstream";
import { shouldUseWebSearch } from "@/lib/web-search";

export type SearchQueryPlan = {
  query: string;
  shouldSearch: boolean;
};

const MAX_PLANNER_RESPONSE_CHARS = 4000;
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
const EXPLICIT_SEARCH_PATTERN = /(联网|搜索|查一下|查找|检索|搜一下|网上|网络|web search|search the web|duckduckgo)/i;
const ATTACHMENT_BOUND_PATTERN =
  /(这|这个|这份|这张|它|附件|文件|文档|pdf|表格|图片|截图|报告|内容|里面|上面|是什么|总结|概括|分析|解读|翻译|提取|what is this|this file|attached file)/i;
const VAGUE_QUERY_PATTERN =
  /^(这|这个|这是什么|它|这个文件|这份文件|此文件|附件|文件|文档|pdf|what is this|this|it)$/i;

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

function jsonFromPlannerResponse(text: string) {
  const trimmed = text.trim().slice(0, MAX_PLANNER_RESPONSE_CHARS);
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

function normalizePlan(value: Record<string, unknown> | null, fallback: SearchQueryPlan) {
  if (!value) {
    return fallback;
  }

  const query = typeof value.query === "string" ? value.query.trim().slice(0, 160) : "";
  const shouldSearch =
    typeof value.shouldSearch === "boolean"
      ? value.shouldSearch
      : typeof value.should_search === "boolean"
        ? value.should_search
        : fallback.shouldSearch;

  const normalizedQuery = query || fallback.query;

  return {
    query: normalizedQuery,
    shouldSearch: shouldSearch && hasSearchableQuery(normalizedQuery)
  };
}

function buildPlannerMessages(options: {
  attachmentCount: number;
  force: boolean;
  prompt: string;
}): UpstreamChatMessage[] {
  const today = new Date().toISOString().slice(0, 10);

  return [
    {
      role: "system",
      content:
        "你是搜索查询规划器，不回答用户问题，只判断是否需要联网搜索并生成搜索关键词。只返回 JSON，不要 Markdown，不要解释。JSON 必须是 {\"shouldSearch\":true|false,\"query\":\"搜索词\"}。搜索词要保留关键实体、地点、时间、政策/价格/版本等限定词；不要只保留单个汉字或“这/这个/它”。国际人物、公司、产品可同时保留中文名和英文常用名，例如“特朗普 Trump 最新政策”。不要编造用户没提到的实体。若用户问题不需要实时信息且没有强制搜索，shouldSearch=false。若用户上传了附件并问“这是什么/总结这个文件/分析这份 PDF”这类指向附件的问题，除非用户明确要求联网搜索，否则 shouldSearch=false。"
    },
    {
      role: "user",
      content: `今天日期：${today}\n强制搜索：${options.force ? "是" : "否"}\n本条消息附件数：${options.attachmentCount}\n用户问题：${options.prompt}`
    }
  ];
}

export async function planWebSearchQuery(options: {
  force: boolean;
  attachmentCount?: number;
  modelId: string;
  prompt: string;
  signal?: AbortSignal;
  settings: AiRuntimeSettings;
}): Promise<SearchQueryPlan> {
  const attachmentBound = isAttachmentBoundPrompt(options.prompt, options.attachmentCount ?? 0);
  const fallback: SearchQueryPlan = {
    query: fallbackQuery(options.prompt),
    shouldSearch:
      !attachmentBound &&
      hasSearchableQuery(fallbackQuery(options.prompt)) &&
      (options.force || shouldUseWebSearch(options.prompt))
  };

  if (attachmentBound || (!options.force && !shouldUseWebSearch(options.prompt))) {
    return fallback;
  }

  if (!options.settings.webSearchEnabled || options.settings.mockResponses) {
    return fallback;
  }

  try {
    const plannerText = await createChatCompletionText(
      options.modelId,
      buildPlannerMessages({
        attachmentCount: options.attachmentCount ?? 0,
        force: options.force,
        prompt: options.prompt
      }),
      options.settings,
      { signal: options.signal }
    );

    const planned = normalizePlan(jsonFromPlannerResponse(plannerText), fallback);

    return attachmentBound ? { ...planned, shouldSearch: false } : planned;
  } catch (error) {
    console.warn(
      "[web-search] Failed to plan search query:",
      error instanceof Error ? error.message : error
    );
    return fallback;
  }
}
