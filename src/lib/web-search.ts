export type WebSearchSource = {
  displayUrl: string;
  snippet: string;
  title: string;
  url: string;
};

export type WebSearchSettings = {
  webSearchEnabled: boolean;
  webSearchProvider: string;
  webSearchMaxResults: number;
};

export type WebSearchResult = {
  query: string;
  sources: WebSearchSource[];
};

const WEB_SEARCH_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_RESULTS = 5;
const REALTIME_TERMS =
  /(最新|今天|今日|现在|当前|实时|新闻|近况|价格|汇率|股价|天气|赛事|赛程|政策|法规|版本|发布|current|latest|today|now|news|price|weather|stock|exchange rate|release|2026)/i;
const GENERIC_QUERY_TERMS = new Set([
  "今日",
  "今天",
  "当前",
  "实时",
  "新闻",
  "最新",
  "近况"
]);
const LOW_QUALITY_REALTIME_SOURCE_PATTERNS = [
  /baike\.baidu\.com/i,
  /wikipedia\.org/i,
  /wiktionary\.org/i,
  /dictionary/i,
  /translate/i
];

function decodeHtml(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCharCode(parseInt(code, 16))
    );
}

function stripTags(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDuckDuckGoUrl(rawUrl: string) {
  const decoded = decodeHtml(rawUrl);

  try {
    const url = new URL(decoded, "https://duckduckgo.com");
    const redirected = url.searchParams.get("uddg");

    if (redirected) {
      return decodeURIComponent(redirected);
    }

    return url.href;
  } catch {
    return decoded;
  }
}

function displayUrlFromUrl(value: string) {
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return value.replace(/^https?:\/\//, "").split("/")[0] || value;
  }
}

function parseDuckDuckGoHtml(html: string, maxResults: number) {
  const sources: WebSearchSource[] = [];
  const seen = new Set<string>();
  const blocks = html.split(/<div[^>]+class="[^"]*\bresult\b[^"]*"[^>]*>/i).slice(1);

  for (const block of blocks) {
    const linkMatch =
      block.match(/<a[^>]+class="[^"]*\bresult__a\b[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i) ||
      block.match(/<a[^>]+class="[^"]*\bresult-link\b[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);

    if (!linkMatch) {
      continue;
    }

    const url = normalizeDuckDuckGoUrl(linkMatch[1] || "");
    const title = stripTags(linkMatch[2] || "");
    const snippetMatch =
      block.match(/<a[^>]+class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i) ||
      block.match(/<td[^>]+class="[^"]*\bresult-snippet\b[^"]*"[^>]*>([\s\S]*?)<\/td>/i) ||
      block.match(/<div[^>]+class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const snippet = stripTags(snippetMatch?.[1] || "");

    if (!title || !url || seen.has(url) || url.includes("duckduckgo.com/y.js")) {
      continue;
    }

    seen.add(url);
    sources.push({
      displayUrl: displayUrlFromUrl(url),
      snippet,
      title,
      url
    });

    if (sources.length >= maxResults) {
      break;
    }
  }

  return sources;
}

function withTimeout(signal?: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEB_SEARCH_TIMEOUT_MS);

  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer)
  };
}

function normalizeQuery(prompt: string) {
  return prompt
    .replace(/^(请|帮我|麻烦你|能不能|可以|请问)?(联网|搜索|查一下|查找|检索|搜一下)/, "")
    .replace(/^(请|帮我|麻烦你|能不能|可以|请问)(我)?/, "")
    .replace(/[。！？!?]+$/g, "")
    .trim()
    .slice(0, 180);
}

function isWeatherQuery(prompt: string) {
  return /(天气|气温|温度|weather|forecast|temperature)/i.test(prompt);
}

function cleanLocationCandidate(value: string) {
  return value
    .replace(/^(请问|请|帮我|麻烦你|能不能|可以|搜索|联网|查一下|查找|检索|搜一下)/, "")
    .replace(/(今天|今日|现在|当前|实时|当地|此刻|明天|后天|未来|最近|一下|如何|怎么样|怎样|什么|的)/g, "")
    .replace(/[，,。？?！!\s]+/g, "")
    .trim();
}

function extractWeatherLocation(prompt: string) {
  const query = normalizeQuery(prompt) || prompt.trim();
  const englishMatch =
    query.match(/(?:weather|forecast|temperature)\s+(?:in|for|at)?\s*([a-zA-Z][a-zA-Z\s.'-]{1,60})/i) ||
    query.match(/(?:in|for|at)\s+([a-zA-Z][a-zA-Z\s.'-]{1,60})\s+(?:weather|forecast|temperature)/i);

  if (englishMatch?.[1]) {
    return englishMatch[1].replace(/\b(today|now|current|latest)\b/gi, "").trim();
  }

  const beforeWeather = cleanLocationCandidate(query.split(/天气|气温|温度/)[0] || "");

  if (/^[\u4e00-\u9fff]{2,12}$/.test(beforeWeather)) {
    return beforeWeather;
  }

  const afterWeather = query.match(/(?:天气|气温|温度).{0,8}?(?:在|到|查)?([\u4e00-\u9fff]{2,12})/);

  if (afterWeather?.[1]) {
    return cleanLocationCandidate(afterWeather[1]);
  }

  return "";
}

export function shouldUseWebSearch(prompt: string) {
  const normalized = prompt.trim();

  if (!normalized) {
    return false;
  }

  return /(联网|搜索|查一下|查找|检索|搜一下)/i.test(normalized) || REALTIME_TERMS.test(normalized);
}

function queryTerms(query: string) {
  const asciiTerms = query
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9.+#-]{1,}/g) ?? [];
  const chineseCandidate = query
    .replace(/[，,。？?！!、；;：:（）()[\]{}"“”'‘’]/g, " ")
    .replace(
      /(请问|请|帮我|麻烦你|能不能|可以|联网|搜索|查一下|查找|检索|搜一下|了解|一下|关于|相关|最新|今天|今日|现在|当前|实时|新闻|近况|有哪些|是什么|怎么样|如何|的|了|和|与|及)/g,
      " "
    );
  const chineseTerms = chineseCandidate.match(/[\u4e00-\u9fff]{2,}/g) ?? [];

  return [...new Set([...asciiTerms, ...chineseTerms])].filter((term) => term.length >= 2);
}

function hasSearchableQueryTerms(query: string) {
  return queryTerms(query).length > 0;
}

function sourceRelevanceScore(query: string, source: WebSearchSource) {
  const terms = queryTerms(query);

  if (terms.length === 0) {
    return 1;
  }

  const title = source.title.toLowerCase();
  const snippet = source.snippet.toLowerCase();
  const host = source.displayUrl.toLowerCase();

  return terms.reduce((score, term) => {
    const normalizedTerm = term.toLowerCase();

    return (
      score +
      (title.includes(normalizedTerm) ? 3 : 0) +
      (snippet.includes(normalizedTerm) ? 1 : 0) +
      (host.includes(normalizedTerm) ? 1 : 0)
    );
  }, 0);
}

function sourceIncludesTerm(source: WebSearchSource, term: string) {
  const normalizedTerm = term.toLowerCase();
  const haystack = `${source.title} ${source.snippet} ${source.displayUrl}`.toLowerCase();

  return haystack.includes(normalizedTerm);
}

function requiredQueryTerms(query: string) {
  return queryTerms(query).filter(
    (term) => !GENERIC_QUERY_TERMS.has(term) && !/^\d{4}$/.test(term)
  );
}

function rankSearchSources(query: string, sources: WebSearchSource[], maxResults: number) {
  const requiredTerms = requiredQueryTerms(query);
  const realtimeQuery = REALTIME_TERMS.test(query);
  const scored = sources
    .map((source, index) => ({
      index,
      score: sourceRelevanceScore(query, source),
      source
    }))
    .filter((item) => {
      if (item.score <= 0) {
        return false;
      }

      if (
        realtimeQuery &&
        LOW_QUALITY_REALTIME_SOURCE_PATTERNS.some((pattern) =>
          pattern.test(`${item.source.url} ${item.source.displayUrl}`)
        )
      ) {
        return false;
      }

      if (requiredTerms.length === 0) {
        return true;
      }

      const matchedRequiredTerms = requiredTerms.filter((term) =>
        sourceIncludesTerm(item.source, term)
      ).length;

      return matchedRequiredTerms >= Math.min(2, requiredTerms.length);
    })
    .sort((left, right) => right.score - left.score || left.index - right.index);

  return scored.slice(0, maxResults).map((item) => item.source);
}

function firstWeatherValue(value: unknown) {
  if (Array.isArray(value)) {
    const first = value[0] as { value?: unknown } | undefined;
    return typeof first?.value === "string" ? first.value : "";
  }

  return typeof value === "string" ? value : "";
}

async function searchWeather(
  prompt: string,
  options?: { signal?: AbortSignal }
): Promise<WebSearchSource | null> {
  if (!isWeatherQuery(prompt)) {
    return null;
  }

  const location = extractWeatherLocation(prompt);

  if (!location) {
    return null;
  }

  const timeout = withTimeout(options?.signal);
  const url = `https://wttr.in/${encodeURIComponent(location)}?format=j1&lang=zh`;

  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        "user-agent": "curl/8.0"
      },
      signal: timeout.signal
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      current_condition?: Array<Record<string, unknown>>;
      nearest_area?: Array<Record<string, unknown>>;
      weather?: Array<Record<string, unknown>>;
    };
    const current = payload.current_condition?.[0];
    const area = payload.nearest_area?.[0];
    const today = payload.weather?.[0];

    if (!current) {
      return null;
    }

    const areaName = firstWeatherValue(area?.areaName) || location;
    const region = firstWeatherValue(area?.region);
    const country = firstWeatherValue(area?.country);
    const place = [areaName, region, country].filter(Boolean).join(", ");
    const desc =
      firstWeatherValue(current.lang_zh) ||
      firstWeatherValue(current.weatherDesc) ||
      "天气状况未知";
    const todayText = today
      ? `今日 ${today.date || ""}：最高 ${today.maxtempC ?? "?"}°C，最低 ${
          today.mintempC ?? "?"
        }°C，平均 ${today.avgtempC ?? "?"}°C。`
      : "";
    const snippet = [
      `${place} 当前 ${desc}，气温 ${current.temp_C ?? "?"}°C，体感 ${
        current.FeelsLikeC ?? "?"
      }°C，湿度 ${current.humidity ?? "?"}%，风速 ${current.windspeedKmph ?? "?"} km/h，降水 ${
        current.precipMM ?? "?"
      } mm，观测时间 ${current.observation_time ?? "未知"} UTC。`,
      todayText
    ]
      .filter(Boolean)
      .join(" ");

    return {
      displayUrl: "wttr.in",
      snippet,
      title: `${location}实时天气`,
      url: `https://wttr.in/${encodeURIComponent(location)}`
    };
  } catch {
    return null;
  } finally {
    timeout.clear();
  }
}

async function searchDuckDuckGo(query: string, maxResults: number, signal?: AbortSignal) {
  const timeout = withTimeout(signal);

  try {
    const response = await fetch(
      `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
          "user-agent":
            "Mozilla/5.0 (compatible; TeamAIGateway/1.0; +https://localhost)"
        },
        signal: timeout.signal
      }
    );

    if (!response.ok) {
      return [];
    }

    return parseDuckDuckGoHtml(await response.text(), maxResults);
  } catch {
    return [];
  } finally {
    timeout.clear();
  }
}

export function formatWebSearchContext(result: WebSearchResult) {
  if (result.sources.length === 0) {
    return "";
  }

  const sources = result.sources
    .map(
      (source, index) =>
        `[${index + 1}] ${source.title}\nURL: ${source.url}\n摘要: ${source.snippet || "无摘要"}`
    )
    .join("\n\n");

  return `联网搜索结果（查询：${result.query}）\n请优先依据这些来源回答，并在使用来源信息的位置用 [1]、[2] 这样的编号引用。不要编造未出现在来源中的实时事实。\n\n${sources}`;
}

export function parseWebSourcesJson(value: string | null | undefined): WebSearchSource[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => {
        const source = item as Partial<WebSearchSource>;
        const url = typeof source.url === "string" ? source.url : "";
        const title = typeof source.title === "string" ? source.title : "";

        if (!url || !title) {
          return null;
        }

        return {
          displayUrl:
            typeof source.displayUrl === "string" && source.displayUrl
              ? source.displayUrl
              : displayUrlFromUrl(url),
          snippet: typeof source.snippet === "string" ? source.snippet : "",
          title,
          url
        };
      })
      .filter((item): item is WebSearchSource => Boolean(item));
  } catch {
    return [];
  }
}

export async function searchWeb(
  prompt: string,
  settings: WebSearchSettings,
  options?: { force?: boolean; query?: string; signal?: AbortSignal }
): Promise<WebSearchResult | null> {
  if (!settings.webSearchEnabled) {
    return null;
  }

  if (!options?.force && !shouldUseWebSearch(prompt)) {
    return null;
  }

  const query = normalizeQuery(options?.query || prompt) || prompt.trim().slice(0, 180);

  if (!hasSearchableQueryTerms(query)) {
    return { query, sources: [] };
  }

  const maxResults = Math.min(8, Math.max(1, settings.webSearchMaxResults || DEFAULT_MAX_RESULTS));
  const weatherSource = await searchWeather(query, { signal: options?.signal });

  if (weatherSource) {
    return { query, sources: [weatherSource] };
  }

  const rawSources = await searchDuckDuckGo(query, maxResults, options?.signal);
  const sources = rankSearchSources(query, rawSources, maxResults);

  return {
    query,
    sources
  };
}
