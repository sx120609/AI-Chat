import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import {
  DEFAULT_REGISTRATION_COST_LIMIT_CENTS,
  normalizeRegistrationCostLimitCents
} from "@/lib/auth-settings";
import { cacheDelete } from "@/lib/cache";
import { normalizeCodingPlanConfig } from "@/lib/coding-plan";
import { jsonError, readJson, requireAdmin } from "@/lib/http";
import {
  DEFAULT_EASYPAY_BALANCE_CENTS_PER_YUAN,
  EASYPAY_NOTIFY_PATH,
  EASYPAY_RETURN_PATH,
  parseEasyPayAmountTiers,
  normalizeEasyPayBalanceCentsPerYuan,
  normalizeEasyPaySettings,
  parseEasyPayMethods,
  normalizeEasyPayDisplayMode
} from "@/lib/easypay";
import {
  buildChatModelCatalog,
  CHAT_MODELS,
  DEFAULT_IMAGE_UPSTREAM_MODEL,
  DEFAULT_REASONING_EFFORT,
  DEFAULT_REASONING_PARAM_MODE,
  DEFAULT_UPSTREAM_MODEL_MAP,
  getEnabledChatModels,
  normalizeReasoningEffort,
  normalizeReasoningParamMode,
  parseModelDisplayConfig,
  parseModelMap,
  type ChatModelDisplayConfig,
  type ChatModelId
} from "@/lib/models";
import { prisma } from "@/lib/prisma";
import { normalizeSiteName, normalizeSiteUrl, SITE_SETTINGS_CACHE_KEY } from "@/lib/site-settings";
import { maskSecret, normalizeSmtpSettings } from "@/lib/smtp";
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
  gpt54ProApiBaseUrl?: string;
  gpt54ProApiKey?: string;
  clearGpt54ProApiKey?: boolean;
  gpt54ProOrgId?: string;
  mockResponses?: boolean;
  chatModelMap?: Record<string, string>;
  chatModelDisplay?: Record<string, ChatModelDisplayConfig>;
  enabledChatModelIds?: string[];
  imageModelId?: string;
  defaultReasoningEffort?: string;
  reasoningParamMode?: string;
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
  registrationEnabled?: boolean;
  registrationRequireEmailVerification?: boolean;
  registrationDefaultCostLimitCents?: number;
  smtpEnabled?: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpUsername?: string;
  smtpPassword?: string;
  clearSmtpPassword?: boolean;
  smtpFromEmail?: string;
  smtpFromName?: string;
  smtpSecure?: boolean;
  smtpStartTls?: boolean;
  easyPayEnabled?: boolean;
  easyPayAllowRefund?: boolean;
  easyPayDisplayMode?: string;
  easyPayMethods?: string[];
  easyPayBalanceCentsPerYuan?: number;
  easyPayAmountTiers?: Array<{
    amountCents?: number;
    balanceCents?: number;
  }>;
  easyPayPid?: string;
  easyPayKey?: string;
  clearEasyPayKey?: boolean;
  easyPayApiBaseUrl?: string;
  easyPayAlipayChannelId?: string;
  easyPayWxpayChannelId?: string;
  codingPlanEnabled?: boolean;
  codingPlanName?: string;
  codingPlanDescription?: string;
  codingPlanPriceCents?: number;
  codingPlanMonthlyCostLimitCents?: number;
  codingPlanPersonalApiEnabled?: boolean;
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
  gpt54ProApiBaseUrl: string;
  gpt54ProApiKey: string | null;
  gpt54ProOrgId: string | null;
  mockResponses: boolean;
  chatModelMapJson: string;
  chatModelDisplayJson: string;
  availableModelsJson: string;
  enabledChatModelsJson: string;
  imageModelId: string;
  defaultReasoningEffort: string;
  reasoningParamMode: string;
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
  registrationEnabled: boolean;
  registrationRequireEmailVerification: boolean;
  registrationDefaultCostLimitCents: number;
  smtpEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
  smtpPassword: string | null;
  smtpFromEmail: string;
  smtpFromName: string;
  smtpSecure: boolean;
  smtpStartTls: boolean;
  easyPayEnabled: boolean;
  easyPayAllowRefund: boolean;
  easyPayDisplayMode: string;
  easyPayMethodsJson: string;
  easyPayBalanceCentsPerYuan: number;
  easyPayAmountTiersJson: string;
  easyPayPid: string;
  easyPayKey: string | null;
  easyPayApiBaseUrl: string;
  easyPayAlipayChannelId: string;
  easyPayWxpayChannelId: string;
  codingPlanEnabled: boolean;
  codingPlanName: string;
  codingPlanDescription: string;
  codingPlanPriceCents: number;
  codingPlanMonthlyCostLimitCents: number;
  codingPlanPersonalApiEnabled: boolean;
  updatedAt: Date;
}) {
  const chatModelMap = parseModelMap(settings.chatModelMapJson);
  const chatModelDisplay = parseModelDisplayConfig(settings.chatModelDisplayJson);
  const chatModels = buildChatModelCatalog(settings);
  const enabledChatModels = getEnabledChatModels(chatModels);

  const easyPayBalanceCentsPerYuan = normalizeEasyPayBalanceCentsPerYuan(
    settings.easyPayBalanceCentsPerYuan
  );
  const codingPlan = normalizeCodingPlanConfig({
    description: settings.codingPlanDescription,
    enabled: settings.codingPlanEnabled,
    monthlyCostLimitCents: settings.codingPlanMonthlyCostLimitCents,
    name: settings.codingPlanName,
    personalApiEnabled: settings.codingPlanPersonalApiEnabled,
    priceCents: settings.codingPlanPriceCents
  });

  return {
    siteName: normalizeSiteName(settings.siteName),
    siteUrl: normalizeSiteUrl(settings.siteUrl),
    apiBaseUrl: settings.apiBaseUrl,
    hasApiKey: Boolean(settings.apiKey),
    apiKeyPreview: maskKey(settings.apiKey),
    orgId: settings.orgId || "",
    gpt54ProApiBaseUrl: settings.gpt54ProApiBaseUrl || "",
    gpt54ProHasApiKey: Boolean(settings.gpt54ProApiKey),
    gpt54ProApiKeyPreview: maskKey(settings.gpt54ProApiKey),
    gpt54ProOrgId: settings.gpt54ProOrgId || "",
    mockResponses: settings.mockResponses,
    chatModelMap,
    chatModelDisplay,
    chatModels,
    enabledChatModelIds: enabledChatModels.map((model) => model.id),
    imageModelId: settings.imageModelId || DEFAULT_IMAGE_UPSTREAM_MODEL,
    defaultReasoningEffort: normalizeReasoningEffort(settings.defaultReasoningEffort),
    reasoningParamMode: normalizeReasoningParamMode(settings.reasoningParamMode),
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
    codingPlanEnabled: codingPlan.enabled,
    codingPlanName: codingPlan.name,
    codingPlanDescription: codingPlan.description,
    codingPlanPriceCents: codingPlan.priceCents,
    codingPlanMonthlyCostLimitCents: codingPlan.monthlyCostLimitCents,
    codingPlanPersonalApiEnabled: codingPlan.personalApiEnabled,
    easyPayNotifyPath: EASYPAY_NOTIFY_PATH,
    easyPayReturnPath: EASYPAY_RETURN_PATH,
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

function normalizeModelDisplay(
  value: Record<string, ChatModelDisplayConfig> | undefined,
  chatModelMapJson: string,
  availableModelsJson: string
) {
  const catalog = buildChatModelCatalog({ chatModelMapJson, availableModelsJson });
  const validIds = new Set(catalog.map((model) => model.id));
  const parsed = parseModelDisplayConfig(JSON.stringify(value ?? {}));
  const next: Record<string, ChatModelDisplayConfig> = {};

  for (const [id, display] of Object.entries(parsed)) {
    if (validIds.has(id)) {
      next[id] = display;
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

function normalizeOptionalBaseUrl(value: string | undefined) {
  return value?.trim() ? normalizeBaseUrl(value) : "";
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
      gpt54ProApiBaseUrl: process.env.AI_GPT54_PRO_API_BASE_URL || "",
      gpt54ProApiKey: process.env.AI_GPT54_PRO_API_KEY || null,
      gpt54ProOrgId: process.env.AI_GPT54_PRO_ORG_ID || null,
      mockResponses: process.env.AI_MOCK_RESPONSES === "true",
      chatModelMapJson: JSON.stringify(DEFAULT_UPSTREAM_MODEL_MAP),
      chatModelDisplayJson: "{}",
      availableModelsJson: "[]",
      enabledChatModelsJson: "[]",
      imageModelId: DEFAULT_IMAGE_UPSTREAM_MODEL,
      defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
      reasoningParamMode: DEFAULT_REASONING_PARAM_MODE,
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
      ),
      registrationEnabled: process.env.REGISTRATION_ENABLED === "true",
      registrationRequireEmailVerification:
        process.env.REGISTRATION_REQUIRE_EMAIL_VERIFICATION === "true",
      registrationDefaultCostLimitCents: normalizeRegistrationCostLimitCents(
        Number(process.env.REGISTRATION_DEFAULT_COST_LIMIT_CENTS) ||
          DEFAULT_REGISTRATION_COST_LIMIT_CENTS
      ),
      smtpEnabled: process.env.SMTP_ENABLED === "true",
      smtpHost: process.env.SMTP_HOST || "",
      smtpPort: Number(process.env.SMTP_PORT) || 587,
      smtpUsername: process.env.SMTP_USERNAME || "",
      smtpPassword: process.env.SMTP_PASSWORD || null,
      smtpFromEmail: process.env.SMTP_FROM_EMAIL || "",
      smtpFromName: process.env.SMTP_FROM_NAME || "",
      smtpSecure: process.env.SMTP_SECURE === "true",
      smtpStartTls: process.env.SMTP_STARTTLS !== "false",
      easyPayEnabled: process.env.EASYPAY_ENABLED === "true",
      easyPayAllowRefund: process.env.EASYPAY_ALLOW_REFUND === "true",
      easyPayDisplayMode: process.env.EASYPAY_DISPLAY_MODE || "qrcode",
      easyPayMethodsJson: process.env.EASYPAY_METHODS_JSON || "[\"alipay\",\"wxpay\"]",
      easyPayBalanceCentsPerYuan: normalizeEasyPayBalanceCentsPerYuan(
        Number(process.env.EASYPAY_BALANCE_CENTS_PER_YUAN) ||
          DEFAULT_EASYPAY_BALANCE_CENTS_PER_YUAN
      ),
      easyPayAmountTiersJson: process.env.EASYPAY_AMOUNT_TIERS_JSON || "[]",
      easyPayPid: process.env.EASYPAY_PID || "",
      easyPayKey: process.env.EASYPAY_KEY || null,
      easyPayApiBaseUrl: process.env.EASYPAY_API_BASE_URL || "",
      easyPayAlipayChannelId: process.env.EASYPAY_ALIPAY_CHANNEL_ID || "",
      easyPayWxpayChannelId: process.env.EASYPAY_WXPAY_CHANNEL_ID || "",
      codingPlanEnabled: process.env.CODING_PLAN_ENABLED === "true",
      codingPlanName: process.env.CODING_PLAN_NAME || "Coding Plan",
      codingPlanDescription:
        process.env.CODING_PLAN_DESCRIPTION || "面向编码任务的月度额度套餐",
      codingPlanPriceCents: Number(process.env.CODING_PLAN_PRICE_CENTS) || 1990,
      codingPlanMonthlyCostLimitCents:
        Number(process.env.CODING_PLAN_MONTHLY_COST_LIMIT_CENTS) || 1000,
      codingPlanPersonalApiEnabled: process.env.CODING_PLAN_PERSONAL_API_ENABLED !== "false"
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
  let gpt54ProApiBaseUrl: string;
  let siteUrl: string;

  try {
    apiBaseUrl = normalizeBaseUrl(body.apiBaseUrl);
    gpt54ProApiBaseUrl = normalizeOptionalBaseUrl(body.gpt54ProApiBaseUrl);
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
  const nextGpt54ProApiKey = body.clearGpt54ProApiKey
    ? null
    : typeof body.gpt54ProApiKey === "string" && body.gpt54ProApiKey.trim()
      ? body.gpt54ProApiKey.trim()
      : existingSettings?.gpt54ProApiKey || null;
  const nextSmtpPassword = body.clearSmtpPassword
    ? null
    : typeof body.smtpPassword === "string" && body.smtpPassword.trim()
      ? body.smtpPassword.trim()
      : existingSettings?.smtpPassword || null;
  const nextEasyPayKey = body.clearEasyPayKey
    ? null
    : typeof body.easyPayKey === "string" && body.easyPayKey.trim()
      ? body.easyPayKey.trim()
      : existingSettings?.easyPayKey || null;
  const registrationEnabled = Boolean(body.registrationEnabled);
  const registrationRequireEmailVerification = Boolean(
    body.registrationRequireEmailVerification
  );
  const registrationDefaultCostLimitCents = normalizeRegistrationCostLimitCents(
    body.registrationDefaultCostLimitCents
  );
  let smtpSettings: ReturnType<typeof normalizeSmtpSettings>;

  try {
    smtpSettings = normalizeSmtpSettings({
      smtpEnabled: body.smtpEnabled,
      smtpHost: body.smtpHost,
      smtpPort: body.smtpPort,
      smtpUsername: body.smtpUsername,
      smtpPassword: nextSmtpPassword,
      smtpFromEmail: body.smtpFromEmail,
      smtpFromName: body.smtpFromName,
      smtpSecure: body.smtpSecure,
      smtpStartTls: body.smtpStartTls
    });
  } catch (smtpError) {
    return jsonError(smtpError instanceof Error ? smtpError.message : "邮件服务设置无效。", 400);
  }

  if (registrationEnabled && registrationRequireEmailVerification && !smtpSettings.smtpEnabled) {
    return jsonError("启用注册邮件验证前，请先启用并配置邮件服务。", 400);
  }

  let easyPaySettings: ReturnType<typeof normalizeEasyPaySettings>;
  const codingPlan = normalizeCodingPlanConfig({
    description: body.codingPlanDescription,
    enabled: body.codingPlanEnabled,
    monthlyCostLimitCents: body.codingPlanMonthlyCostLimitCents,
    name: body.codingPlanName,
    personalApiEnabled: body.codingPlanPersonalApiEnabled,
    priceCents: body.codingPlanPriceCents
  });

  try {
    easyPaySettings = normalizeEasyPaySettings({
      easyPayEnabled: body.easyPayEnabled,
      easyPayAllowRefund: body.easyPayAllowRefund,
      easyPayDisplayMode: body.easyPayDisplayMode,
      easyPayMethodsJson: JSON.stringify(body.easyPayMethods ?? []),
      easyPayBalanceCentsPerYuan: body.easyPayBalanceCentsPerYuan,
      easyPayAmountTiersJson: JSON.stringify(body.easyPayAmountTiers ?? []),
      easyPayPid: body.easyPayPid,
      easyPayKey: nextEasyPayKey,
      easyPayApiBaseUrl: body.easyPayApiBaseUrl,
      easyPayAlipayChannelId: body.easyPayAlipayChannelId,
      easyPayWxpayChannelId: body.easyPayWxpayChannelId
    });
  } catch (easyPayError) {
    return jsonError(
      easyPayError instanceof Error ? easyPayError.message : "易支付设置无效。",
      400
    );
  }

  const data: {
    siteName: string;
    siteUrl: string;
    apiBaseUrl: string;
    apiKey?: string | null;
    orgId: string | null;
    gpt54ProApiBaseUrl: string;
    gpt54ProApiKey?: string | null;
    gpt54ProOrgId: string | null;
    mockResponses: boolean;
    chatModelMapJson: string;
    chatModelDisplayJson: string;
    enabledChatModelsJson: string;
    imageModelId: string;
    defaultReasoningEffort: string;
    reasoningParamMode: string;
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
    registrationEnabled: boolean;
    registrationRequireEmailVerification: boolean;
    registrationDefaultCostLimitCents: number;
    smtpEnabled: boolean;
    smtpHost: string;
    smtpPort: number;
    smtpUsername: string;
    smtpPassword?: string | null;
    smtpFromEmail: string;
    smtpFromName: string;
    smtpSecure: boolean;
    smtpStartTls: boolean;
    easyPayEnabled: boolean;
    easyPayAllowRefund: boolean;
    easyPayDisplayMode: string;
    easyPayMethodsJson: string;
    easyPayBalanceCentsPerYuan: number;
    easyPayAmountTiersJson: string;
    easyPayPid: string;
    easyPayKey?: string | null;
    easyPayApiBaseUrl: string;
    easyPayAlipayChannelId: string;
    easyPayWxpayChannelId: string;
    codingPlanEnabled: boolean;
    codingPlanName: string;
    codingPlanDescription: string;
    codingPlanPriceCents: number;
    codingPlanMonthlyCostLimitCents: number;
    codingPlanPersonalApiEnabled: boolean;
  } = {
    siteName: normalizeSiteName(body.siteName),
    siteUrl,
    apiBaseUrl,
    orgId: body.orgId?.trim() || null,
    gpt54ProApiBaseUrl,
    gpt54ProApiKey: nextGpt54ProApiKey,
    gpt54ProOrgId: body.gpt54ProOrgId?.trim() || null,
    mockResponses: Boolean(body.mockResponses),
    chatModelMapJson: JSON.stringify(normalizeModelMap(body.chatModelMap)),
    chatModelDisplayJson: "{}",
    enabledChatModelsJson: "[]",
    imageModelId: body.imageModelId?.trim() || DEFAULT_IMAGE_UPSTREAM_MODEL,
    defaultReasoningEffort: normalizeReasoningEffort(body.defaultReasoningEffort),
    reasoningParamMode: normalizeReasoningParamMode(body.reasoningParamMode),
    systemPromptMode: normalizeSystemPromptMode(body.systemPromptMode),
    customSystemPrompt: body.customSystemPrompt?.trim() || "",
    modelSystemPromptsJson: "{}",
    codeInterpreterEnabled: Boolean(body.codeInterpreterEnabled),
    codeInterpreterSandbox,
    codeInterpreterAllowPackageInstall: Boolean(body.codeInterpreterAllowPackageInstall),
    codeInterpreterPipIndexUrl,
    webSearchEnabled: Boolean(body.webSearchEnabled),
    webSearchProvider: "duckduckgo",
    webSearchMaxResults: normalizeWebSearchMaxResults(body.webSearchMaxResults),
    registrationEnabled,
    registrationRequireEmailVerification,
    registrationDefaultCostLimitCents,
    smtpEnabled: smtpSettings.smtpEnabled,
    smtpHost: smtpSettings.smtpHost,
    smtpPort: smtpSettings.smtpPort,
    smtpUsername: smtpSettings.smtpUsername,
    smtpPassword: smtpSettings.smtpPassword,
    smtpFromEmail: smtpSettings.smtpFromEmail,
    smtpFromName: smtpSettings.smtpFromName,
    smtpSecure: smtpSettings.smtpSecure,
    smtpStartTls: smtpSettings.smtpStartTls,
    easyPayEnabled: easyPaySettings.easyPayEnabled,
    easyPayAllowRefund: easyPaySettings.easyPayAllowRefund,
    easyPayDisplayMode: easyPaySettings.easyPayDisplayMode,
    easyPayMethodsJson: JSON.stringify(easyPaySettings.easyPayMethods),
    easyPayBalanceCentsPerYuan: easyPaySettings.easyPayBalanceCentsPerYuan,
    easyPayAmountTiersJson: JSON.stringify(easyPaySettings.easyPayAmountTiers),
    easyPayPid: easyPaySettings.easyPayPid,
    easyPayKey: easyPaySettings.easyPayKey,
    easyPayApiBaseUrl: easyPaySettings.easyPayApiBaseUrl,
    easyPayAlipayChannelId: easyPaySettings.easyPayAlipayChannelId,
    easyPayWxpayChannelId: easyPaySettings.easyPayWxpayChannelId,
    codingPlanEnabled: codingPlan.enabled,
    codingPlanName: codingPlan.name,
    codingPlanDescription: codingPlan.description,
    codingPlanPriceCents: codingPlan.priceCents,
    codingPlanMonthlyCostLimitCents: codingPlan.monthlyCostLimitCents,
    codingPlanPersonalApiEnabled: codingPlan.personalApiEnabled
  };
  data.enabledChatModelsJson = JSON.stringify(
    normalizeEnabledModelIds(
      body.enabledChatModelIds,
      data.chatModelMapJson,
      existingSettings?.availableModelsJson || "[]"
    )
  );
  data.chatModelDisplayJson = JSON.stringify(
    normalizeModelDisplay(
      body.chatModelDisplay,
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
