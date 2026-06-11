import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { cacheDelete } from "@/lib/cache";
import { jsonError, requireAdmin } from "@/lib/http";
import {
  buildChatModelCatalog,
  DEFAULT_CONTEXT_COMPRESSION_ENABLED,
  DEFAULT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT,
  DEFAULT_LONG_CONTEXT_THRESHOLD_TOKENS,
  DEFAULT_UPSTREAM_MODEL_MAP,
  getEnabledChatModels,
  normalizeContextCompressionThresholdPercent,
  normalizeLongContextThresholdTokens,
  normalizeReasoningEffort,
  normalizeReasoningParamMode,
  parseModelMap
} from "@/lib/models";
import { prisma } from "@/lib/prisma";
import { SITE_SETTINGS_CACHE_KEY } from "@/lib/site-settings";
import {
  normalizeSystemPromptMode,
  parseModelSystemPrompts
} from "@/lib/system-prompt";
import {
  AI_RUNTIME_SETTINGS_CACHE_KEY,
  fetchUpstreamModelIds,
  getAiRuntimeSettings
} from "@/lib/upstream";

export const runtime = "nodejs";

function maskKey(key: string | null | undefined) {
  if (!key) {
    return "";
  }

  return key.length <= 8 ? "已设置" : `...${key.slice(-4)}`;
}

async function serializeSettings() {
  const settings = await prisma.aiSettings.findUnique({
    where: { id: "default" }
  });

  if (!settings) {
    throw new Error("API 设置不存在。");
  }

  const chatModels = buildChatModelCatalog(settings);

  return {
    siteName: settings.siteName || "Team AI Gateway",
    siteUrl: settings.siteUrl || "",
    apiBaseUrl: settings.apiBaseUrl,
    hasApiKey: Boolean(settings.apiKey),
    apiKeyPreview: maskKey(settings.apiKey),
    orgId: settings.orgId || "",
    mockResponses: settings.mockResponses,
    chatModelMap: parseModelMap(settings.chatModelMapJson),
    chatModels,
    enabledChatModelIds: getEnabledChatModels(chatModels).map((model) => model.id),
    imageModelId: settings.imageModelId,
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
    codeInterpreterPipIndexUrl: settings.codeInterpreterPipIndexUrl || "https://pypi.org/simple",
    webSearchEnabled: settings.webSearchEnabled,
    webSearchProvider:
      settings.webSearchProvider === "bing" || settings.webSearchProvider === "google"
        ? settings.webSearchProvider
        : "duckduckgo",
    webSearchMaxResults: Math.min(8, Math.max(1, settings.webSearchMaxResults || 5)),
    hasGoogleSearchApiKey: Boolean(settings.googleSearchApiKey),
    googleSearchApiKeyPreview: maskKey(settings.googleSearchApiKey),
    googleSearchCx: settings.googleSearchCx || "",
    updatedAt: settings.updatedAt.toISOString()
  };
}

export async function POST(request: NextRequest) {
  const currentUser = await getUserFromRequest(request);
  const error = requireAdmin(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  const runtimeSettings = await getAiRuntimeSettings();

  try {
    const modelIds = await fetchUpstreamModelIds(runtimeSettings);
    const existingSettings = await prisma.aiSettings.findUnique({
      where: { id: "default" }
    });
    const existingEnabled = existingSettings?.enabledChatModelsJson || "[]";

    await prisma.aiSettings.upsert({
      where: { id: "default" },
      update: {
        availableModelsJson: JSON.stringify(modelIds),
        enabledChatModelsJson: existingEnabled
      },
      create: {
        id: "default",
        apiBaseUrl: runtimeSettings.apiBaseUrl,
        apiKey: runtimeSettings.apiKey || null,
        orgId: runtimeSettings.orgId || null,
        mockResponses: runtimeSettings.mockResponses,
        chatModelMapJson: JSON.stringify(DEFAULT_UPSTREAM_MODEL_MAP),
        availableModelsJson: JSON.stringify(modelIds),
        enabledChatModelsJson: "[]",
        imageModelId: runtimeSettings.imageModelId,
        defaultReasoningEffort: runtimeSettings.defaultReasoningEffort,
        reasoningParamMode: runtimeSettings.reasoningParamMode,
        contextCompressionEnabled: runtimeSettings.contextCompressionEnabled,
        contextCompressionThresholdPercent:
          runtimeSettings.contextCompressionThresholdPercent,
        longContextThresholdTokens:
          runtimeSettings.longContextThresholdTokens || DEFAULT_LONG_CONTEXT_THRESHOLD_TOKENS,
        systemPromptMode: runtimeSettings.systemPromptMode,
        customSystemPrompt: runtimeSettings.customSystemPrompt,
        modelSystemPromptsJson: JSON.stringify(runtimeSettings.modelSystemPrompts),
        codeInterpreterEnabled: runtimeSettings.codeInterpreterEnabled,
        codeInterpreterSandbox: runtimeSettings.codeInterpreterSandbox,
        codeInterpreterAllowPackageInstall: runtimeSettings.codeInterpreterAllowPackageInstall,
        codeInterpreterPipIndexUrl: runtimeSettings.codeInterpreterPipIndexUrl,
        webSearchEnabled: runtimeSettings.webSearchEnabled,
        webSearchProvider: runtimeSettings.webSearchProvider,
        webSearchMaxResults: runtimeSettings.webSearchMaxResults,
        googleSearchApiKey: runtimeSettings.googleSearchApiKey || null,
        googleSearchCx: runtimeSettings.googleSearchCx || null
      }
    });

    await cacheDelete([AI_RUNTIME_SETTINGS_CACHE_KEY, SITE_SETTINGS_CACHE_KEY]);

    return NextResponse.json({
      count: modelIds.length,
      settings: await serializeSettings()
    });
  } catch (refreshError) {
    return jsonError(
      refreshError instanceof Error ? refreshError.message : "刷新模型失败。",
      502
    );
  }
}
