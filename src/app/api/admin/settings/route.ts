import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { cacheDelete } from "@/lib/cache";
import { jsonError, readJson, requireAdmin } from "@/lib/http";
import {
  buildChatModelCatalog,
  CHAT_MODELS,
  DEFAULT_CONTEXT_COMPRESSION_ENABLED,
  DEFAULT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT,
  DEFAULT_IMAGE_UPSTREAM_MODEL,
  DEFAULT_LONG_CONTEXT_THRESHOLD_TOKENS,
  DEFAULT_REASONING_EFFORT,
  DEFAULT_REASONING_PARAM_MODE,
  DEFAULT_UPSTREAM_MODEL_MAP,
  getEnabledChatModels,
  normalizeContextCompressionThresholdPercent,
  normalizeLongContextThresholdTokens,
  normalizeReasoningEffort,
  normalizeReasoningParamMode,
  parseModelMap,
  type ChatModelId
} from "@/lib/models";
import { prisma } from "@/lib/prisma";
import { normalizeSiteName, normalizeSiteUrl, SITE_SETTINGS_CACHE_KEY } from "@/lib/site-settings";
import {
  DEFAULT_SYSTEM_PROMPT_MODE,
  normalizeModelSystemPrompts,
  normalizeSystemPromptMode,
  parseModelSystemPrompts
} from "@/lib/system-prompt";
import { AI_RUNTIME_SETTINGS_CACHE_KEY } from "@/lib/upstream";

export const runtime = "nodejs";

type SettingsBody = {
  siteName?: string;
  siteUrl?: string;
  apiBaseUrl?: string;
  apiKey?: string;
  clearApiKey?: boolean;
  orgId?: string;
  mockResponses?: boolean;
  chatModelMap?: Record<string, string>;
  enabledChatModelIds?: string[];
  imageModelId?: string;
  defaultReasoningEffort?: string;
  reasoningParamMode?: string;
  contextCompressionEnabled?: boolean;
  contextCompressionThresholdPercent?: number;
  longContextThresholdTokens?: number;
  systemPromptMode?: string;
  customSystemPrompt?: string;
  modelSystemPrompts?: Record<string, string>;
  codeInterpreterEnabled?: boolean;
  codeInterpreterSandbox?: string;
  codeInterpreterAllowPackageInstall?: boolean;
  codeInterpreterPipIndexUrl?: string;
  webSearchEnabled?: boolean;
  webSearchProvider?: string;
  webSearchMaxResults?: number;
};

function maskKey(key: string | null | undefined) {
  if (!key) {
    return "";
  }

  return key.length <= 8 ? "已设置" : `...${key.slice(-4)}`;
}

function serializeSettings(settings: {
  siteName: string;
  siteUrl: string;
  apiBaseUrl: string;
  apiKey: string | null;
  orgId: string | null;
  mockResponses: boolean;
  chatModelMapJson: string;
  availableModelsJson: string;
  enabledChatModelsJson: string;
  imageModelId: string;
  defaultReasoningEffort: string;
  reasoningParamMode: string;
  contextCompressionEnabled: boolean;
  contextCompressionThresholdPercent: number;
  longContextThresholdTokens: number;
  systemPromptMode: string;
  customSystemPrompt: string;
  modelSystemPromptsJson: string;
  codeInterpreterEnabled: boolean;
  codeInterpreterSandbox: string;
  codeInterpreterAllowPackageInstall: boolean;
  codeInterpreterPipIndexUrl: string;
  webSearchEnabled: boolean;
  webSearchProvider: string;
  webSearchMaxResults: number;
  updatedAt: Date;
}) {
  const chatModelMap = parseModelMap(settings.chatModelMapJson);
  const chatModels = buildChatModelCatalog(settings);
  const enabledChatModels = getEnabledChatModels(chatModels);

  return {
    siteName: normalizeSiteName(settings.siteName),
    siteUrl: normalizeSiteUrl(settings.siteUrl),
    apiBaseUrl: settings.apiBaseUrl,
    hasApiKey: Boolean(settings.apiKey),
    apiKeyPreview: maskKey(settings.apiKey),
    orgId: settings.orgId || "",
    mockResponses: settings.mockResponses,
    chatModelMap,
    chatModels,
    enabledChatModelIds: enabledChatModels.map((model) => model.id),
    imageModelId: settings.imageModelId || DEFAULT_IMAGE_UPSTREAM_MODEL,
    defaultReasoningEffort: normalizeReasoningEffort(settings.defaultReasoningEffort),
    reasoningParamMode: normalizeReasoningParamMode(settings.reasoningParamMode),
    contextCompressionEnabled:
      settings.contextCompressionEnabled ?? DEFAULT_CONTEXT_COMPRESSION_ENABLED,
    contextCompressionThresholdPercent: normalizeContextCompressionThresholdPercent(
      settings.contextCompressionThresholdPercent ||
        DEFAULT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT
    ),
    longContextThresholdTokens: normalizeLongContextThresholdTokens(
      settings.longContextThresholdTokens
    ),
    systemPromptMode: normalizeSystemPromptMode(settings.systemPromptMode),
    customSystemPrompt: settings.customSystemPrompt || "",
    modelSystemPrompts: parseModelSystemPrompts(settings.modelSystemPromptsJson),
    codeInterpreterEnabled: settings.codeInterpreterEnabled,
    codeInterpreterSandbox: settings.codeInterpreterSandbox || "docker",
    codeInterpreterAllowPackageInstall: settings.codeInterpreterAllowPackageInstall,
    codeInterpreterPipIndexUrl:
      settings.codeInterpreterPipIndexUrl || "https://pypi.org/simple",
    webSearchEnabled: settings.webSearchEnabled,
    webSearchProvider: "duckduckgo",
    webSearchMaxResults: Math.min(8, Math.max(1, settings.webSearchMaxResults || 5)),
    updatedAt: settings.updatedAt.toISOString()
  };
}

function normalizeModelMap(value: Record<string, string> | undefined) {
  const next = { ...DEFAULT_UPSTREAM_MODEL_MAP };

  for (const model of CHAT_MODELS) {
    const mapped = value?.[model.id];

    if (typeof mapped === "string" && mapped.trim()) {
      next[model.id as ChatModelId] = mapped.trim();
    }
  }

  return next;
}

function normalizeEnabledModelIds(
  value: string[] | undefined,
  chatModelMapJson: string,
  availableModelsJson: string
) {
  const catalog = buildChatModelCatalog({ chatModelMapJson, availableModelsJson });
  const validIds = new Set(catalog.map((model) => model.id));
  const next = (value ?? [])
    .map((id) => id.trim())
    .filter((id, index, list) => id && validIds.has(id) && list.indexOf(id) === index);

  if (next.length > 0) {
    return next;
  }

  return getEnabledChatModels(catalog).map((model) => model.id);
}

function normalizeBaseUrl(value: string | undefined) {
  const raw = value?.trim();

  if (!raw) {
    return "https://api.openai.com/v1";
  }

  try {
    const url = new URL(raw);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("invalid protocol");
    }

    return raw.replace(/\/+$/, "");
  } catch {
    throw new Error("请输入有效的 API 地址，例如 https://api.openai.com/v1");
  }
}

function normalizeCodeInterpreterSandbox(value: string | undefined) {
  const sandbox = value?.trim() || "docker";

  if (sandbox !== "docker") {
    throw new Error("代码解释器当前只支持 Docker 沙箱。");
  }

  return sandbox;
}

function normalizePipIndexUrl(value: string | undefined) {
  const raw = value?.trim() || "https://pypi.org/simple";

  try {
    const url = new URL(raw);

    if (url.protocol !== "https:") {
      throw new Error("invalid protocol");
    }

    return raw.replace(/\/+$/, "");
  } catch {
    throw new Error("PyPI 源必须是 HTTPS 地址，例如 https://pypi.org/simple");
  }
}

function normalizeWebSearchMaxResults(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return 5;
  }

  return Math.min(8, Math.max(1, Math.round(Number(value))));
}

export async function GET(request: NextRequest) {
  const currentUser = await getUserFromRequest(request);
  const error = requireAdmin(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  const settings = await prisma.aiSettings.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      siteName: normalizeSiteName(process.env.SITE_NAME),
      siteUrl: normalizeSiteUrl(process.env.SITE_URL),
      apiBaseUrl: process.env.AI_API_BASE_URL || "https://api.openai.com/v1",
      apiKey: process.env.AI_API_KEY || null,
      orgId: process.env.AI_ORG_ID || null,
      mockResponses: process.env.AI_MOCK_RESPONSES === "true",
      chatModelMapJson: JSON.stringify(DEFAULT_UPSTREAM_MODEL_MAP),
      availableModelsJson: "[]",
      enabledChatModelsJson: "[]",
      imageModelId: DEFAULT_IMAGE_UPSTREAM_MODEL,
      defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
      reasoningParamMode: DEFAULT_REASONING_PARAM_MODE,
      contextCompressionEnabled: DEFAULT_CONTEXT_COMPRESSION_ENABLED,
      contextCompressionThresholdPercent: DEFAULT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT,
      longContextThresholdTokens: DEFAULT_LONG_CONTEXT_THRESHOLD_TOKENS,
      systemPromptMode: DEFAULT_SYSTEM_PROMPT_MODE,
      customSystemPrompt: "",
      modelSystemPromptsJson: "{}",
      codeInterpreterEnabled: process.env.CODE_INTERPRETER_ENABLED === "true",
      codeInterpreterSandbox: process.env.CODE_INTERPRETER_SANDBOX || "docker",
      codeInterpreterAllowPackageInstall:
        process.env.CODE_INTERPRETER_ALLOW_PACKAGE_INSTALL === "true",
      codeInterpreterPipIndexUrl:
        process.env.CODE_INTERPRETER_PIP_INDEX_URL || "https://pypi.org/simple",
      webSearchEnabled: process.env.WEB_SEARCH_ENABLED === "true",
      webSearchProvider: "duckduckgo",
      webSearchMaxResults: normalizeWebSearchMaxResults(
        Number(process.env.WEB_SEARCH_MAX_RESULTS) || 5
      )
    }
  });

  await cacheDelete([AI_RUNTIME_SETTINGS_CACHE_KEY, SITE_SETTINGS_CACHE_KEY]);

  return NextResponse.json({ settings: serializeSettings(settings) });
}

export async function PATCH(request: NextRequest) {
  const currentUser = await getUserFromRequest(request);
  const error = requireAdmin(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  let body: SettingsBody;

  try {
    body = await readJson<SettingsBody>(request);
  } catch (readError) {
    return jsonError(readError instanceof Error ? readError.message : "保存 API 设置失败。", 400);
  }

  let apiBaseUrl: string;
  let codeInterpreterPipIndexUrl: string;
  let codeInterpreterSandbox: string;
  let siteUrl: string;

  try {
    apiBaseUrl = normalizeBaseUrl(body.apiBaseUrl);
    codeInterpreterSandbox = normalizeCodeInterpreterSandbox(body.codeInterpreterSandbox);
    codeInterpreterPipIndexUrl = normalizePipIndexUrl(body.codeInterpreterPipIndexUrl);
    siteUrl = normalizeSiteUrl(body.siteUrl);
  } catch (validationError) {
    return jsonError(
      validationError instanceof Error ? validationError.message : "设置内容无效。",
      400
    );
  }

  const existingSettings = await prisma.aiSettings.findUnique({
    where: { id: "default" }
  });

  const data: {
    siteName: string;
    siteUrl: string;
    apiBaseUrl: string;
    apiKey?: string | null;
    orgId: string | null;
    mockResponses: boolean;
    chatModelMapJson: string;
    enabledChatModelsJson: string;
    imageModelId: string;
    defaultReasoningEffort: string;
    reasoningParamMode: string;
    contextCompressionEnabled: boolean;
    contextCompressionThresholdPercent: number;
    longContextThresholdTokens: number;
    systemPromptMode: string;
    customSystemPrompt: string;
    modelSystemPromptsJson: string;
    codeInterpreterEnabled: boolean;
    codeInterpreterSandbox: string;
    codeInterpreterAllowPackageInstall: boolean;
    codeInterpreterPipIndexUrl: string;
    webSearchEnabled: boolean;
    webSearchProvider: string;
    webSearchMaxResults: number;
  } = {
    siteName: normalizeSiteName(body.siteName),
    siteUrl,
    apiBaseUrl,
    orgId: body.orgId?.trim() || null,
    mockResponses: Boolean(body.mockResponses),
    chatModelMapJson: JSON.stringify(normalizeModelMap(body.chatModelMap)),
    enabledChatModelsJson: "[]",
    imageModelId: body.imageModelId?.trim() || DEFAULT_IMAGE_UPSTREAM_MODEL,
    defaultReasoningEffort: normalizeReasoningEffort(body.defaultReasoningEffort),
    reasoningParamMode: normalizeReasoningParamMode(body.reasoningParamMode),
    contextCompressionEnabled: Boolean(body.contextCompressionEnabled),
    contextCompressionThresholdPercent: normalizeContextCompressionThresholdPercent(
      body.contextCompressionThresholdPercent
    ),
    longContextThresholdTokens: normalizeLongContextThresholdTokens(
      body.longContextThresholdTokens
    ),
    systemPromptMode: normalizeSystemPromptMode(body.systemPromptMode),
    customSystemPrompt: body.customSystemPrompt?.trim() || "",
    modelSystemPromptsJson: "{}",
    codeInterpreterEnabled: Boolean(body.codeInterpreterEnabled),
    codeInterpreterSandbox,
    codeInterpreterAllowPackageInstall: Boolean(body.codeInterpreterAllowPackageInstall),
    codeInterpreterPipIndexUrl,
    webSearchEnabled: Boolean(body.webSearchEnabled),
    webSearchProvider: "duckduckgo",
    webSearchMaxResults: normalizeWebSearchMaxResults(body.webSearchMaxResults)
  };
  data.enabledChatModelsJson = JSON.stringify(
    normalizeEnabledModelIds(
      body.enabledChatModelIds,
      data.chatModelMapJson,
      existingSettings?.availableModelsJson || "[]"
    )
  );
  data.modelSystemPromptsJson = JSON.stringify(
    normalizeModelSystemPrompts(
      body.modelSystemPrompts,
      buildChatModelCatalog({
        chatModelMapJson: data.chatModelMapJson,
        availableModelsJson: existingSettings?.availableModelsJson || "[]"
      }).map((model) => model.id)
    )
  );

  if (body.clearApiKey) {
    data.apiKey = null;
  } else if (typeof body.apiKey === "string" && body.apiKey.trim()) {
    data.apiKey = body.apiKey.trim();
  }

  const settings = await prisma.aiSettings.upsert({
    where: { id: "default" },
    update: data,
    create: {
      id: "default",
      ...data
    }
  });

  await cacheDelete([AI_RUNTIME_SETTINGS_CACHE_KEY, SITE_SETTINGS_CACHE_KEY]);

  return NextResponse.json({ settings: serializeSettings(settings) });
}
