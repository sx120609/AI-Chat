import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/password";
import {
  DEFAULT_IMAGE_UPSTREAM_MODEL,
  DEFAULT_REASONING_EFFORT,
  DEFAULT_REASONING_PARAM_MODE,
  DEFAULT_UPSTREAM_MODEL_MAP,
  normalizeReasoningEffort
} from "../src/lib/models";
import {
  normalizeSiteName,
  normalizeSiteUrl
} from "../src/lib/site-settings";
import { DEFAULT_SYSTEM_PROMPT_MODE } from "../src/lib/system-prompt";

function nextQuotaResetAt(start: Date) {
  const next = new Date(start);
  next.setMonth(next.getMonth() + 1);
  return next;
}

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || "管理员";

  if (!email || !password || password.length < 8) {
    throw new Error("Set ADMIN_EMAIL and an ADMIN_PASSWORD of at least 8 characters before seeding.");
  }

  const passwordHash = await hashPassword(password);
  const quotaResetAt = new Date();

  await prisma.user.upsert({
    where: { email },
    update: {
      name,
      userGroup: "VIP",
      passwordHash,
      role: "ADMIN",
      active: true,
      emailVerified: true
    },
    create: {
      email,
      name,
      userGroup: "VIP",
      passwordHash,
      role: "ADMIN",
      emailVerified: true,
      monthlyTokenLimit: 1000000,
      monthlyMessageLimit: 2000,
      aiPointsBalanceCents: 20000,
      monthlyCostLimitCents: 0,
      quotaResetAt,
      quotaNextResetAt: nextQuotaResetAt(quotaResetAt),
      quotaSystemMigratedAt: quotaResetAt
    }
  });

  const existingSettings = await prisma.aiSettings.findUnique({
    where: { id: "default" }
  });

  await prisma.aiSettings.upsert({
    where: { id: "default" },
    update: {
      siteName: normalizeSiteName(process.env.SITE_NAME || existingSettings?.siteName),
      siteUrl: normalizeSiteUrl(process.env.SITE_URL || existingSettings?.siteUrl),
      apiBaseUrl: process.env.AI_API_BASE_URL || existingSettings?.apiBaseUrl,
      apiKey: process.env.AI_API_KEY || existingSettings?.apiKey,
      orgId: process.env.AI_ORG_ID || existingSettings?.orgId,
      mockResponses:
        process.env.AI_MOCK_RESPONSES === undefined
          ? existingSettings?.mockResponses
          : process.env.AI_MOCK_RESPONSES === "true",
      chatModelMapJson: existingSettings?.chatModelMapJson || JSON.stringify(DEFAULT_UPSTREAM_MODEL_MAP),
      chatModelDisplayJson: existingSettings?.chatModelDisplayJson || "{}",
      availableModelsJson: existingSettings?.availableModelsJson || "[]",
      enabledChatModelsJson: existingSettings?.enabledChatModelsJson || "[]",
      imageModelId: existingSettings?.imageModelId || DEFAULT_IMAGE_UPSTREAM_MODEL,
      defaultReasoningEffort: normalizeReasoningEffort(
        existingSettings?.defaultReasoningEffort || DEFAULT_REASONING_EFFORT
      ),
      reasoningParamMode: existingSettings?.reasoningParamMode || DEFAULT_REASONING_PARAM_MODE,
      systemPromptMode: existingSettings?.systemPromptMode || DEFAULT_SYSTEM_PROMPT_MODE,
      customSystemPrompt: existingSettings?.customSystemPrompt || "",
      modelSystemPromptsJson: existingSettings?.modelSystemPromptsJson || "{}",
      codeInterpreterEnabled:
        process.env.CODE_INTERPRETER_ENABLED === undefined
          ? existingSettings?.codeInterpreterEnabled || false
          : process.env.CODE_INTERPRETER_ENABLED === "true",
      codeInterpreterSandbox:
        process.env.CODE_INTERPRETER_SANDBOX || existingSettings?.codeInterpreterSandbox || "docker",
      codeInterpreterAllowPackageInstall:
        process.env.CODE_INTERPRETER_ALLOW_PACKAGE_INSTALL === undefined
          ? existingSettings?.codeInterpreterAllowPackageInstall || false
          : process.env.CODE_INTERPRETER_ALLOW_PACKAGE_INSTALL === "true",
      codeInterpreterPipIndexUrl:
        process.env.CODE_INTERPRETER_PIP_INDEX_URL ||
        existingSettings?.codeInterpreterPipIndexUrl ||
        "https://pypi.org/simple",
      webSearchEnabled:
        process.env.WEB_SEARCH_ENABLED === undefined
          ? existingSettings?.webSearchEnabled || false
          : process.env.WEB_SEARCH_ENABLED === "true",
      webSearchProvider: "duckduckgo",
      webSearchMaxResults:
        Number(process.env.WEB_SEARCH_MAX_RESULTS) ||
        existingSettings?.webSearchMaxResults ||
        5,
      registrationEnabled:
        process.env.REGISTRATION_ENABLED === undefined
          ? existingSettings?.registrationEnabled || false
          : process.env.REGISTRATION_ENABLED === "true",
      registrationRequireEmailVerification:
        process.env.REGISTRATION_REQUIRE_EMAIL_VERIFICATION === undefined
          ? existingSettings?.registrationRequireEmailVerification || false
          : process.env.REGISTRATION_REQUIRE_EMAIL_VERIFICATION === "true",
      registrationDefaultCostLimitCents:
        Number(process.env.REGISTRATION_DEFAULT_COST_LIMIT_CENTS) ||
        existingSettings?.registrationDefaultCostLimitCents ||
        5000,
      smtpEnabled:
        process.env.SMTP_ENABLED === undefined
          ? existingSettings?.smtpEnabled || false
          : process.env.SMTP_ENABLED === "true",
      smtpHost: process.env.SMTP_HOST || existingSettings?.smtpHost || "",
      smtpPort: Number(process.env.SMTP_PORT) || existingSettings?.smtpPort || 587,
      smtpUsername: process.env.SMTP_USERNAME || existingSettings?.smtpUsername || "",
      smtpPassword: process.env.SMTP_PASSWORD || existingSettings?.smtpPassword || null,
      smtpFromEmail: process.env.SMTP_FROM_EMAIL || existingSettings?.smtpFromEmail || "",
      smtpFromName: process.env.SMTP_FROM_NAME || existingSettings?.smtpFromName || "",
      smtpSecure:
        process.env.SMTP_SECURE === undefined
          ? existingSettings?.smtpSecure || false
          : process.env.SMTP_SECURE === "true",
      smtpStartTls:
        process.env.SMTP_STARTTLS === undefined
          ? existingSettings?.smtpStartTls ?? true
          : process.env.SMTP_STARTTLS !== "false",
      easyPayEnabled:
        process.env.EASYPAY_ENABLED === undefined
          ? existingSettings?.easyPayEnabled || false
          : process.env.EASYPAY_ENABLED === "true",
      easyPayAllowRefund:
        process.env.EASYPAY_ALLOW_REFUND === undefined
          ? existingSettings?.easyPayAllowRefund || false
          : process.env.EASYPAY_ALLOW_REFUND === "true",
      easyPayDisplayMode:
        process.env.EASYPAY_DISPLAY_MODE || existingSettings?.easyPayDisplayMode || "qrcode",
      easyPayMethodsJson:
        process.env.EASYPAY_METHODS_JSON ||
        existingSettings?.easyPayMethodsJson ||
        "[\"alipay\",\"wxpay\"]",
      easyPayBalanceCentsPerYuan:
        Number(process.env.EASYPAY_BALANCE_CENTS_PER_YUAN) ||
        existingSettings?.easyPayBalanceCentsPerYuan ||
        100,
      easyPayAmountTiersJson:
        process.env.EASYPAY_AMOUNT_TIERS_JSON ||
        existingSettings?.easyPayAmountTiersJson ||
        "[]",
      easyPayPid: process.env.EASYPAY_PID || existingSettings?.easyPayPid || "",
      easyPayKey: process.env.EASYPAY_KEY || existingSettings?.easyPayKey || null,
      easyPayApiBaseUrl:
        process.env.EASYPAY_API_BASE_URL || existingSettings?.easyPayApiBaseUrl || "",
      easyPayAlipayChannelId:
        process.env.EASYPAY_ALIPAY_CHANNEL_ID ||
        existingSettings?.easyPayAlipayChannelId ||
        "",
      easyPayWxpayChannelId:
        process.env.EASYPAY_WXPAY_CHANNEL_ID ||
        existingSettings?.easyPayWxpayChannelId ||
        ""
    },
    create: {
      id: "default",
      siteName: normalizeSiteName(process.env.SITE_NAME),
      siteUrl: normalizeSiteUrl(process.env.SITE_URL),
      apiBaseUrl: process.env.AI_API_BASE_URL || "https://api.openai.com/v1",
      apiKey: process.env.AI_API_KEY || null,
      orgId: process.env.AI_ORG_ID || null,
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
      webSearchMaxResults: Number(process.env.WEB_SEARCH_MAX_RESULTS) || 5,
      registrationEnabled: process.env.REGISTRATION_ENABLED === "true",
      registrationRequireEmailVerification:
        process.env.REGISTRATION_REQUIRE_EMAIL_VERIFICATION === "true",
      registrationDefaultCostLimitCents:
        Number(process.env.REGISTRATION_DEFAULT_COST_LIMIT_CENTS) || 5000,
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
      easyPayBalanceCentsPerYuan:
        Number(process.env.EASYPAY_BALANCE_CENTS_PER_YUAN) || 100,
      easyPayAmountTiersJson: process.env.EASYPAY_AMOUNT_TIERS_JSON || "[]",
      easyPayPid: process.env.EASYPAY_PID || "",
      easyPayKey: process.env.EASYPAY_KEY || null,
      easyPayApiBaseUrl: process.env.EASYPAY_API_BASE_URL || "",
      easyPayAlipayChannelId: process.env.EASYPAY_ALIPAY_CHANNEL_ID || "",
      easyPayWxpayChannelId: process.env.EASYPAY_WXPAY_CHANNEL_ID || ""
    }
  });

  console.log(`Seeded administrator: ${email}`);
  console.log("AI API settings can be edited in the admin dashboard.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
