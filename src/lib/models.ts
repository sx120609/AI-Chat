export type ChatModelId = string;
export type GatewayMode = "CHAT" | "IMAGE";
export type ModelSource = "default" | "upstream";
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";
export type ReasoningParamMode = "disabled" | "chat" | "responses";

export type ChatModelConfig = {
  id: ChatModelId;
  label: string;
  upstreamId: string;
  inputCentsPerMillionTokens: number;
  cachedInputCentsPerMillionTokens: number;
  outputCentsPerMillionTokens: number;
  contextWindowTokens: number;
  contextNote: string;
  source: ModelSource;
  enabled: boolean;
  supportsReasoning: boolean;
};

export const REASONING_EFFORTS: Array<{
  id: ReasoningEffort;
  label: string;
  shortLabel: string;
}> = [
  { id: "low", label: "低", shortLabel: "低" },
  { id: "medium", label: "中", shortLabel: "中" },
  { id: "high", label: "高", shortLabel: "高" },
  { id: "xhigh", label: "超高", shortLabel: "超高" }
];

export const REASONING_PARAM_MODES: Array<{
  id: ReasoningParamMode;
  label: string;
}> = [
  { id: "chat", label: "Chat Completions: reasoning_effort" },
  { id: "responses", label: "Responses 风格: reasoning.effort" },
  { id: "disabled", label: "关闭：永不透传推理参数" }
];

export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "medium";
export const DEFAULT_REASONING_PARAM_MODE: ReasoningParamMode = "chat";
export const DEFAULT_LONG_CONTEXT_THRESHOLD_TOKENS = 270_000;

const DEFAULT_DYNAMIC_INPUT_CENTS_PER_MILLION = 100;
const DEFAULT_DYNAMIC_CACHED_INPUT_CENTS_PER_MILLION = 10;
const DEFAULT_DYNAMIC_OUTPUT_CENTS_PER_MILLION = 500;
const DEFAULT_DYNAMIC_CONTEXT_WINDOW_TOKENS = 128_000;

export const CHAT_MODELS: ChatModelConfig[] = [
  {
    id: "GPT-5.5",
    label: "GPT-5.5",
    upstreamId: "gpt-5.5",
    inputCentsPerMillionTokens: 500,
    cachedInputCentsPerMillionTokens: 50,
    outputCentsPerMillionTokens: 3000,
    contextWindowTokens: 1_000_000,
    contextNote: "旗舰",
    source: "default",
    enabled: true,
    supportsReasoning: true
  },
  {
    id: "GPT-5.4",
    label: "GPT-5.4",
    upstreamId: "gpt-5.4",
    inputCentsPerMillionTokens: 250,
    cachedInputCentsPerMillionTokens: 25,
    outputCentsPerMillionTokens: 1500,
    contextWindowTokens: 1_000_000,
    contextNote: "均衡",
    source: "default",
    enabled: true,
    supportsReasoning: true
  },
  {
    id: "GPT-5.4-Mini",
    label: "GPT-5.4-Mini",
    upstreamId: "gpt-5.4-mini",
    inputCentsPerMillionTokens: 75,
    cachedInputCentsPerMillionTokens: 7.5,
    outputCentsPerMillionTokens: 450,
    contextWindowTokens: 1_000_000,
    contextNote: "低成本",
    source: "default",
    enabled: true,
    supportsReasoning: true
  },
  {
    id: "GPT-5.3-Codex-Spark",
    label: "GPT-5.3-Codex-Spark",
    upstreamId: "gpt-5.3-codex-spark",
    inputCentsPerMillionTokens: 300,
    cachedInputCentsPerMillionTokens: 30,
    outputCentsPerMillionTokens: 1500,
    contextWindowTokens: 400_000,
    contextNote: "代码",
    source: "default",
    enabled: true,
    supportsReasoning: true
  }
];

export const IMAGE_MODEL = {
  id: "image2",
  label: "image2",
  fixedCostCents: 5,
  promptCentsPerMillionTokens: 120
};

export const DEFAULT_UPSTREAM_MODEL_MAP: Record<string, string> = Object.fromEntries(
  CHAT_MODELS.map((model) => [model.id, model.upstreamId])
);

export const DEFAULT_IMAGE_UPSTREAM_MODEL = "image2";

export function parseModelMap(value: string | null | undefined) {
  const next = { ...DEFAULT_UPSTREAM_MODEL_MAP };

  if (!value) {
    return next;
  }

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;

    for (const model of CHAT_MODELS) {
      const mapped = parsed[model.id];

      if (typeof mapped === "string" && mapped.trim()) {
        next[model.id] = mapped.trim();
      }
    }
  } catch {
    return next;
  }

  return next;
}

export function parseModelIds(value: string | null | undefined) {
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
        if (typeof item === "string") {
          return item.trim();
        }

        if (item && typeof item === "object" && "id" in item && typeof item.id === "string") {
          return item.id.trim();
        }

        return "";
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function uniqueModelIds(ids: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const id of ids) {
    const normalized = id.trim();

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

export function inferSupportsReasoning(modelId: string) {
  const normalized = modelId.toLowerCase();

  return (
    normalized.startsWith("gpt-5") ||
    normalized.startsWith("o1") ||
    normalized.startsWith("o3") ||
    normalized.startsWith("o4") ||
    normalized.includes("reason")
  );
}

export function inferContextWindowTokens(modelId: string) {
  const normalized = modelId.toLowerCase();

  if (normalized.includes("gpt-5.5") || normalized.includes("gpt-5.4")) {
    return 1_000_000;
  }

  if (
    normalized.startsWith("gpt-5") ||
    normalized.startsWith("o1") ||
    normalized.startsWith("o3") ||
    normalized.startsWith("o4")
  ) {
    return 400_000;
  }

  return DEFAULT_DYNAMIC_CONTEXT_WINDOW_TOKENS;
}

export function isLikelyChatModelId(modelId: string) {
  const normalized = modelId.toLowerCase();

  return ![
    "audio",
    "dall-e",
    "embedding",
    "image",
    "moderation",
    "realtime",
    "sora",
    "speech",
    "tts",
    "transcribe",
    "whisper"
  ].some((keyword) => normalized.includes(keyword));
}

export function buildChatModelCatalog(settings?: {
  chatModelMapJson?: string | null;
  availableModelsJson?: string | null;
  enabledChatModelsJson?: string | null;
}) {
  const modelMap = parseModelMap(settings?.chatModelMapJson);
  const upstreamIds = uniqueModelIds(parseModelIds(settings?.availableModelsJson));
  const enabledIds = uniqueModelIds(parseModelIds(settings?.enabledChatModelsJson));
  const defaultModels = CHAT_MODELS.map((model) => ({
    ...model,
    upstreamId: modelMap[model.id] || model.upstreamId,
    contextWindowTokens: inferContextWindowTokens(modelMap[model.id] || model.upstreamId),
    supportsReasoning: inferSupportsReasoning(modelMap[model.id] || model.upstreamId)
  }));
  const knownIds = new Set<string>();

  for (const model of defaultModels) {
    knownIds.add(model.id);
    knownIds.add(model.upstreamId);
  }

  const fetchedModels = upstreamIds
    .filter((id) => !knownIds.has(id) && isLikelyChatModelId(id))
    .map<ChatModelConfig>((id) => ({
      id,
      label: id,
      upstreamId: id,
      inputCentsPerMillionTokens: DEFAULT_DYNAMIC_INPUT_CENTS_PER_MILLION,
      cachedInputCentsPerMillionTokens: DEFAULT_DYNAMIC_CACHED_INPUT_CENTS_PER_MILLION,
      outputCentsPerMillionTokens: DEFAULT_DYNAMIC_OUTPUT_CENTS_PER_MILLION,
      contextWindowTokens: inferContextWindowTokens(id),
      contextNote: "上游",
      source: "upstream",
      enabled: true,
      supportsReasoning: inferSupportsReasoning(id)
    }));
  const catalog = [...defaultModels, ...fetchedModels];
  const enabledSet = new Set(enabledIds);

  if (enabledSet.size === 0) {
    return catalog;
  }

  return catalog.map((model) => ({
    ...model,
    enabled: enabledSet.has(model.id)
  }));
}

export function getEnabledChatModels(catalog: ChatModelConfig[]) {
  const enabled = catalog.filter((model) => model.enabled);

  return enabled.length > 0 ? enabled : catalog.slice(0, 1);
}

export function getChatModel(modelId: string | undefined, catalog = CHAT_MODELS) {
  const enabled = getEnabledChatModels(catalog);

  return enabled.find((model) => model.id === modelId) ?? enabled[0] ?? CHAT_MODELS[0];
}

export function isChatModel(modelId: string | undefined, catalog = CHAT_MODELS): modelId is string {
  if (!modelId) {
    return false;
  }

  return getEnabledChatModels(catalog).some((model) => model.id === modelId);
}

export function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  if (value === "none" || value === "minimal") {
    return "low";
  }

  if (value === "auto") {
    return DEFAULT_REASONING_EFFORT;
  }

  return REASONING_EFFORTS.some((item) => item.id === value)
    ? (value as ReasoningEffort)
    : DEFAULT_REASONING_EFFORT;
}

export function normalizeReasoningParamMode(value: unknown): ReasoningParamMode {
  return REASONING_PARAM_MODES.some((item) => item.id === value)
    ? (value as ReasoningParamMode)
    : DEFAULT_REASONING_PARAM_MODE;
}

export function normalizeLongContextThresholdTokens(value: unknown) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_LONG_CONTEXT_THRESHOLD_TOKENS;
  }

  return Math.max(8_000, Math.min(2_000_000, Math.round(parsed)));
}

export function estimateChatCostCents(
  modelId: string,
  promptTokens: number,
  completionTokens: number,
  cachedPromptTokens = 0,
  catalog = CHAT_MODELS
) {
  return estimateChatCostForModel(
    getChatModel(modelId, catalog),
    promptTokens,
    completionTokens,
    cachedPromptTokens
  );
}

export function estimateChatCostForModel(
  model: ChatModelConfig,
  promptTokens: number,
  completionTokens: number,
  cachedPromptTokens = 0
) {
  const normalizedCachedPromptTokens = Math.min(
    Math.max(0, Math.round(cachedPromptTokens)),
    Math.max(0, Math.round(promptTokens))
  );
  const uncachedPromptTokens = Math.max(0, promptTokens - normalizedCachedPromptTokens);
  const promptCost = (uncachedPromptTokens / 1_000_000) * model.inputCentsPerMillionTokens;
  const cachedPromptCost =
    (normalizedCachedPromptTokens / 1_000_000) * model.cachedInputCentsPerMillionTokens;
  const completionCost = (completionTokens / 1_000_000) * model.outputCentsPerMillionTokens;

  return Math.max(0, promptCost + cachedPromptCost + completionCost);
}

export function estimateImageCostCents(promptTokens: number) {
  return Math.max(
    IMAGE_MODEL.fixedCostCents,
    Math.ceil(
      IMAGE_MODEL.fixedCostCents +
        (promptTokens / 1_000_000) * IMAGE_MODEL.promptCentsPerMillionTokens
    )
  );
}
