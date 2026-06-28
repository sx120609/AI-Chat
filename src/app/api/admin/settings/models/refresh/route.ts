import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { normalizeRegistrationCostLimitCents } from "@/lib/auth-settings";
import { cacheDelete } from "@/lib/cache";
import {
  DEFAULT_EASYPAY_BALANCE_CENTS_PER_YUAN,
  EASYPAY_NOTIFY_PATH,
  EASYPAY_RETURN_PATH,
  parseEasyPayAmountTiers,
  normalizeEasyPayBalanceCentsPerYuan,
  normalizeEasyPayDisplayMode,
  parseEasyPayMethods
} from "@/lib/easypay";
import { jsonError, requireAdmin } from "@/lib/http";
import {
  buildChatModelCatalog,
  DEFAULT_UPSTREAM_MODEL_MAP,
  getEnabledChatModels,
  normalizeReasoningEffort,
  normalizeReasoningParamMode,
  parseModelDisplayConfig,
  parseModelMap
} from "@/lib/models";
import { prisma } from "@/lib/prisma";
import { SITE_SETTINGS_CACHE_KEY } from "@/lib/site-settings";
import {
  normalizeSystemPromptMode,
  parseModelSystemPrompts
} from "@/lib/system-prompt";
import { maskSecret } from "@/lib/smtp";
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

  const easyPayBalanceCentsPerYuan = normalizeEasyPayBalanceCentsPerYuan(
    settings.easyPayBalanceCentsPerYuan
  );

  return {
    siteName: settings.siteName || "Team AI Gateway",
    siteUrl: settings.siteUrl || "",
    apiBaseUrl: settings.apiBaseUrl,
    hasApiKey: Boolean(settings.apiKey),
    apiKeyPreview: maskKey(settings.apiKey),
    orgId: settings.orgId || "",
    mockResponses: settings.mockResponses,
    chatModelMap: parseModelMap(settings.chatModelMapJson),
    chatModelDisplay: parseModelDisplayConfig(settings.chatModelDisplayJson),
    chatModels,
    enabledChatModelIds: getEnabledChatModels(chatModels).map((model) => model.id),
    imageModelId: settings.imageModelId,
    defaultReasoningEffort: normalizeReasoningEffort(settings.defaultReasoningEffort),
    reasoningParamMode: normalizeReasoningParamMode(settings.reasoningParamMode),
    systemPromptMode: normalizeSystemPromptMode(settings.systemPromptMode),
    customSystemPrompt: settings.customSystemPrompt || "",
    modelSystemPrompts: parseModelSystemPrompts(settings.modelSystemPromptsJson),
    codeInterpreterEnabled: settings.codeInterpreterEnabled,
    codeInterpreterSandbox: settings.codeInterpreterSandbox || "docker",
    codeInterpreterAllowPackageInstall: settings.codeInterpreterAllowPackageInstall,
    codeInterpreterPipIndexUrl: settings.codeInterpreterPipIndexUrl || "https://pypi.org/simple",
    webSearchEnabled: settings.webSearchEnabled,
    webSearchProvider: "duckduckgo",
    webSearchMaxResults: Math.min(8, Math.max(1, settings.webSearchMaxResults || 5)),
    registrationEnabled: settings.registrationEnabled,
    registrationRequireEmailVerification: settings.registrationRequireEmailVerification,
    registrationDefaultCostLimitCents: normalizeRegistrationCostLimitCents(
      settings.registrationDefaultCostLimitCents
    ),
    smtpEnabled: settings.smtpEnabled,
    smtpHost: settings.smtpHost || "",
    smtpPort: settings.smtpPort || 587,
    smtpUsername: settings.smtpUsername || "",
    smtpHasPassword: Boolean(settings.smtpPassword),
    smtpPasswordPreview: maskSecret(settings.smtpPassword),
    smtpFromEmail: settings.smtpFromEmail || "",
    smtpFromName: settings.smtpFromName || "",
    smtpSecure: settings.smtpSecure,
    smtpStartTls: settings.smtpStartTls,
    easyPayEnabled: settings.easyPayEnabled,
    easyPayAllowRefund: settings.easyPayAllowRefund,
    easyPayDisplayMode: normalizeEasyPayDisplayMode(settings.easyPayDisplayMode),
    easyPayMethods: parseEasyPayMethods(settings.easyPayMethodsJson),
    easyPayBalanceCentsPerYuan,
    easyPayAmountTiers: parseEasyPayAmountTiers(
      settings.easyPayAmountTiersJson,
      easyPayBalanceCentsPerYuan
    ),
    easyPayPid: settings.easyPayPid || "",
    easyPayHasKey: Boolean(settings.easyPayKey),
    easyPayKeyPreview: maskSecret(settings.easyPayKey),
    easyPayApiBaseUrl: settings.easyPayApiBaseUrl || "",
    easyPayAlipayChannelId: settings.easyPayAlipayChannelId || "",
    easyPayWxpayChannelId: settings.easyPayWxpayChannelId || "",
    easyPayNotifyPath: EASYPAY_NOTIFY_PATH,
    easyPayReturnPath: EASYPAY_RETURN_PATH,
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
        chatModelDisplayJson: "{}",
        availableModelsJson: JSON.stringify(modelIds),
        enabledChatModelsJson: "[]",
        imageModelId: runtimeSettings.imageModelId,
        defaultReasoningEffort: runtimeSettings.defaultReasoningEffort,
        reasoningParamMode: runtimeSettings.reasoningParamMode,
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
        registrationEnabled: false,
        registrationRequireEmailVerification: false,
        registrationDefaultCostLimitCents: 5000,
        smtpEnabled: false,
        smtpHost: "",
        smtpPort: 587,
        smtpUsername: "",
        smtpPassword: null,
        smtpFromEmail: "",
        smtpFromName: "",
        smtpSecure: false,
        smtpStartTls: true,
        easyPayEnabled: false,
        easyPayAllowRefund: false,
        easyPayDisplayMode: "qrcode",
        easyPayMethodsJson: "[\"alipay\",\"wxpay\"]",
        easyPayBalanceCentsPerYuan: DEFAULT_EASYPAY_BALANCE_CENTS_PER_YUAN,
        easyPayAmountTiersJson: "[]",
        easyPayPid: "",
        easyPayKey: null,
        easyPayApiBaseUrl: "",
        easyPayAlipayChannelId: "",
        easyPayWxpayChannelId: ""
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
