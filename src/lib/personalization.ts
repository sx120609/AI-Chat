export type PersonalizationLevel = "default" | "low" | "medium" | "high";
export type BaseStyle = "default" | "concise" | "balanced" | "detailed";

export type PersonalizationSettings = {
  baseStyle: BaseStyle;
  traits: {
    warmth: PersonalizationLevel;
    enthusiasm: PersonalizationLevel;
    structure: PersonalizationLevel;
    emoji: PersonalizationLevel;
  };
  quickAnswers: boolean;
  customInstructions: string;
  about: {
    nickname: string;
    occupation: string;
    details: string;
  };
  memoryEnabled: boolean;
};

const PERSONALIZATION_KIND = "ai-chat-personalization";
const PERSONALIZATION_VERSION = 1;

const BASE_STYLES: BaseStyle[] = ["default", "concise", "balanced", "detailed"];
const LEVELS: PersonalizationLevel[] = ["default", "low", "medium", "high"];

function defaultPersonalizationSettings(): PersonalizationSettings {
  return {
    baseStyle: "default",
    traits: {
      warmth: "default",
      enthusiasm: "default",
      structure: "default",
      emoji: "default"
    },
    quickAnswers: true,
    customInstructions: "",
    about: {
      nickname: "",
      occupation: "",
      details: ""
    },
    memoryEnabled: true
  };
}

function pickOption<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === "string" && options.includes(value as T) ? (value as T) : fallback;
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function normalizePersonalizationSettings(value: unknown): PersonalizationSettings {
  const defaults = defaultPersonalizationSettings();
  const input = value && typeof value === "object" ? (value as Partial<PersonalizationSettings>) : {};
  const traits: Partial<PersonalizationSettings["traits"]> =
    input.traits && typeof input.traits === "object" ? input.traits : {};
  const about: Partial<PersonalizationSettings["about"]> =
    input.about && typeof input.about === "object" ? input.about : {};

  return {
    baseStyle: pickOption(input.baseStyle, BASE_STYLES, defaults.baseStyle),
    traits: {
      warmth: pickOption(traits.warmth, LEVELS, defaults.traits.warmth),
      enthusiasm: pickOption(traits.enthusiasm, LEVELS, defaults.traits.enthusiasm),
      structure: pickOption(traits.structure, LEVELS, defaults.traits.structure),
      emoji: pickOption(traits.emoji, LEVELS, defaults.traits.emoji)
    },
    quickAnswers: typeof input.quickAnswers === "boolean" ? input.quickAnswers : defaults.quickAnswers,
    customInstructions: cleanText(input.customInstructions, 900),
    about: {
      nickname: cleanText(about.nickname, 80),
      occupation: cleanText(about.occupation, 120),
      details: cleanText(about.details, 900)
    },
    memoryEnabled: typeof input.memoryEnabled === "boolean" ? input.memoryEnabled : defaults.memoryEnabled
  };
}

export function parsePersonalizationSettings(value: unknown): PersonalizationSettings {
  const text = typeof value === "string" ? value.trim() : "";

  if (!text) {
    return defaultPersonalizationSettings();
  }

  try {
    const payload = JSON.parse(text) as {
      kind?: string;
      settings?: unknown;
      version?: number;
    };

    if (payload.kind === PERSONALIZATION_KIND && payload.version === PERSONALIZATION_VERSION) {
      return normalizePersonalizationSettings(payload.settings);
    }
  } catch {
    // Older profiles stored a plain free-form prompt. Keep it as the custom instruction.
  }

  return normalizePersonalizationSettings({
    customInstructions: text
  });
}

export function serializePersonalizationSettings(settings: PersonalizationSettings) {
  return JSON.stringify({
    kind: PERSONALIZATION_KIND,
    version: PERSONALIZATION_VERSION,
    settings: normalizePersonalizationSettings(settings)
  });
}

const BASE_STYLE_PROMPTS: Record<BaseStyle, string> = {
  default: "",
  concise: "回复风格保持简洁直接，先给结论，避免不必要的铺垫。",
  balanced: "回复风格保持均衡：先给可执行结论，再补充必要原因和细节。",
  detailed: "回复风格偏详细深入，解释关键推理、边界条件和可选方案。"
};

const TRAIT_PROMPTS: Record<keyof PersonalizationSettings["traits"], Record<PersonalizationLevel, string>> = {
  warmth: {
    default: "",
    low: "语气保持克制、专业，不过度安抚。",
    medium: "语气自然友好，在清晰表达的基础上保持适度体贴。",
    high: "语气更温和体贴，适当照顾用户感受。"
  },
  enthusiasm: {
    default: "",
    low: "表达保持冷静，不使用夸张语气。",
    medium: "表达可以有一点积极感，但不要显得浮夸。",
    high: "表达更热情，但仍然保持信息密度和判断力。"
  },
  structure: {
    default: "",
    low: "少用标题和列表，优先用短段落自然回答。",
    medium: "需要比较、步骤或检查清单时使用标题和列表。",
    high: "偏好清晰标题、列表和分段，让答案便于扫描。"
  },
  emoji: {
    default: "",
    low: "不要主动使用表情符号。",
    medium: "仅在轻松场景少量使用表情符号。",
    high: "可以适度使用表情符号，但不要影响专业性。"
  }
};

export function formatPersonalizationForPrompt(value: unknown) {
  const settings = parsePersonalizationSettings(value);
  const lines: string[] = [];
  const baseStylePrompt = BASE_STYLE_PROMPTS[settings.baseStyle];

  if (baseStylePrompt) {
    lines.push(baseStylePrompt);
  }

  (Object.keys(settings.traits) as Array<keyof PersonalizationSettings["traits"]>).forEach((key) => {
    const prompt = TRAIT_PROMPTS[key][settings.traits[key]];

    if (prompt) {
      lines.push(prompt);
    }
  });

  if (settings.quickAnswers) {
    lines.push("优先快速回答：先用一两句给出直接答案；如果问题复杂，再展开必要细节。");
  }

  if (settings.customInstructions) {
    lines.push(`自定义指令：${settings.customInstructions}`);
  }

  if (settings.memoryEnabled) {
    const aboutLines = [
      settings.about.nickname ? `称呼用户为：${settings.about.nickname}` : "",
      settings.about.occupation ? `用户职业或身份：${settings.about.occupation}` : "",
      settings.about.details ? `用户补充信息：${settings.about.details}` : ""
    ].filter(Boolean);

    if (aboutLines.length > 0) {
      lines.push(`关于用户：\n${aboutLines.join("\n")}`);
    }
  }

  return lines.join("\n");
}
