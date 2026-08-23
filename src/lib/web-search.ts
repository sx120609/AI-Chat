export type WebSearchSource = {
  displayUrl: string;
  snippet: string;
  title: string;
  url: string;
};

export type WebSearchResult = {
  query: string;
  sources: WebSearchSource[];
};

const REALTIME_TERMS =
  /(最新|今天|今日|现在|当前|实时|新闻|近况|价格|汇率|股价|天气|赛事|赛程|政策|法规|版本|发布|current|latest|today|now|news|price|weather|stock|exchange rate|release|2026)/i;
const SEARCH_SOURCE_TYPES = new Set([
  "url",
  "url_citation",
  "web_search_result",
  "search_result"
]);
const SEARCH_SOURCE_CONTAINER_KEYS = new Set([
  "annotations",
  "citations",
  "results",
  "sources"
]);

function displayUrlFromUrl(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value.replace(/^https?:\/\//, "").split("/")[0] || value;
  }
}

function normalizedHttpUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  try {
    const url = new URL(value.trim());

    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function sourceFromObject(value: Record<string, unknown>, containerKey: string) {
  const nestedCitation =
    value.url_citation && typeof value.url_citation === "object"
      ? (value.url_citation as Record<string, unknown>)
      : null;
  const source = nestedCitation ?? value;
  const type = firstText(source.type, value.type).toLowerCase();
  const candidate =
    SEARCH_SOURCE_TYPES.has(type) || SEARCH_SOURCE_CONTAINER_KEYS.has(containerKey);

  if (!candidate) {
    return null;
  }

  const url = normalizedHttpUrl(source.url ?? source.href);

  if (!url) {
    return null;
  }

  return {
    displayUrl: displayUrlFromUrl(url),
    snippet: firstText(
      source.snippet,
      source.page_content,
      source.description,
      source.text
    ),
    title: firstText(source.title, source.name, displayUrlFromUrl(url)),
    url
  } satisfies WebSearchSource;
}

export function shouldUseWebSearch(prompt: string) {
  const normalized = prompt.trim();

  return Boolean(normalized && REALTIME_TERMS.test(normalized));
}

export function extractWebSearchSources(payload: unknown, maxResults = 8) {
  const sources: WebSearchSource[] = [];
  const seen = new Set<string>();

  const visit = (value: unknown, containerKey = "", depth = 0) => {
    if (depth > 10 || sources.length >= maxResults || value === null || value === undefined) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, containerKey, depth + 1));
      return;
    }

    if (typeof value !== "object") {
      return;
    }

    const object = value as Record<string, unknown>;
    const source = sourceFromObject(object, containerKey);

    if (source && !seen.has(source.url)) {
      seen.add(source.url);
      sources.push(source);
    }

    for (const [key, nested] of Object.entries(object)) {
      visit(nested, key.toLowerCase(), depth + 1);
    }
  };

  visit(payload);
  return sources.slice(0, Math.max(1, maxResults));
}

export function mergeWebSearchSources(
  current: WebSearchSource[],
  incoming: WebSearchSource[],
  maxResults = 8
) {
  const merged = new Map<string, WebSearchSource>();

  for (const source of [...current, ...incoming]) {
    const url = normalizedHttpUrl(source.url);

    if (!url) {
      continue;
    }

    const previous = merged.get(url);
    merged.set(url, {
      displayUrl: source.displayUrl || previous?.displayUrl || displayUrlFromUrl(url),
      snippet: source.snippet || previous?.snippet || "",
      title: source.title || previous?.title || displayUrlFromUrl(url),
      url
    });
  }

  return Array.from(merged.values()).slice(0, Math.max(1, maxResults));
}

export function parseWebSourcesJson(value: string | null | undefined) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return mergeWebSearchSources(
      [],
      parsed.flatMap((item) => {
        if (!item || typeof item !== "object") {
          return [];
        }

        const source = item as Partial<WebSearchSource>;
        const url = normalizedHttpUrl(source.url);

        if (!url) {
          return [];
        }

        return [
          {
            displayUrl:
              typeof source.displayUrl === "string" && source.displayUrl.trim()
                ? source.displayUrl.trim()
                : displayUrlFromUrl(url),
            snippet: typeof source.snippet === "string" ? source.snippet.trim() : "",
            title:
              typeof source.title === "string" && source.title.trim()
                ? source.title.trim()
                : displayUrlFromUrl(url),
            url
          }
        ];
      })
    );
  } catch {
    return [];
  }
}
