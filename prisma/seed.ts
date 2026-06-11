import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/password";
import {
  DEFAULT_CONTEXT_COMPRESSION_ENABLED,
  DEFAULT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT,
  DEFAULT_IMAGE_UPSTREAM_MODEL,
  DEFAULT_LONG_CONTEXT_THRESHOLD_TOKENS,
  DEFAULT_REASONING_EFFORT,
  DEFAULT_REASONING_PARAM_MODE,
  DEFAULT_UPSTREAM_MODEL_MAP,
  normalizeLongContextThresholdTokens,
  normalizeReasoningEffort
} from "../src/lib/models";
import {
  normalizeSiteName,
  normalizeSiteUrl
} from "../src/lib/site-settings";
import { DEFAULT_SYSTEM_PROMPT_MODE } from "../src/lib/system-prompt";

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || "管理员";

  if (!email || !password || password.length < 8) {
    throw new Error("Set ADMIN_EMAIL and an ADMIN_PASSWORD of at least 8 characters before seeding.");
  }

  const passwordHash = await hashPassword(password);

  await prisma.user.upsert({
    where: { email },
    update: {
      name,
      passwordHash,
      role: "ADMIN",
      active: true
    },
    create: {
      email,
      name,
      passwordHash,
      role: "ADMIN",
      monthlyTokenLimit: 1000000,
      monthlyMessageLimit: 2000,
      monthlyCostLimitCents: 20000
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
      availableModelsJson: existingSettings?.availableModelsJson || "[]",
      enabledChatModelsJson: existingSettings?.enabledChatModelsJson || "[]",
      imageModelId: existingSettings?.imageModelId || DEFAULT_IMAGE_UPSTREAM_MODEL,
      defaultReasoningEffort: normalizeReasoningEffort(
        existingSettings?.defaultReasoningEffort || DEFAULT_REASONING_EFFORT
      ),
      reasoningParamMode: existingSettings?.reasoningParamMode || DEFAULT_REASONING_PARAM_MODE,
      contextCompressionEnabled:
        existingSettings?.contextCompressionEnabled ?? DEFAULT_CONTEXT_COMPRESSION_ENABLED,
      contextCompressionThresholdPercent:
        existingSettings?.contextCompressionThresholdPercent ??
        DEFAULT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT,
      longContextThresholdTokens: normalizeLongContextThresholdTokens(
        existingSettings?.longContextThresholdTokens || DEFAULT_LONG_CONTEXT_THRESHOLD_TOKENS
      ),
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
        5
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
      webSearchMaxResults: Number(process.env.WEB_SEARCH_MAX_RESULTS) || 5
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
