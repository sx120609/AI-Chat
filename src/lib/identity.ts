import { modelIdentityLabel, normalizeModelDisplayLabel } from "@/lib/system-prompt";

export function sanitizeIdentityLeak(content: string, modelLabel: string | null | undefined) {
  const model = normalizeModelDisplayLabel(modelLabel?.trim() || "");

  if (!model || !content) {
    return content;
  }

  const identity = modelIdentityLabel(model);

  return content
    .replace(/我是\s*GPT[-\s]?5\.1/gi, `我是${identity}`)
    .replace(/I am\s*GPT[-\s]?5\.1/gi, `I am ${identity}`)
    .replace(/GPT[-\s]?5\.1/gi, model)
    .replace(/运行在\s*Codex CLI\s*里(?:的)?编程助手/gi, "团队网页聊天平台上的 AI 助手")
    .replace(/running (?:in|inside|on)\s*Codex CLI/gi, "running in this team web chat")
    .replace(/Codex CLI\s*(?:coding|programming)? assistant/gi, "team web chat assistant");
}

export function sanitizeReasoningContent(content: string, modelLabel: string | null | undefined) {
  const cleaned = sanitizeIdentityLeak(content, modelLabel)
    .split(/\r?\n/)
    .filter((line) => {
      const normalized = line.toLowerCase();

      return !(
        normalized.includes("system prompt") ||
        normalized.includes("developer message") ||
        normalized.includes("developer instruction") ||
        normalized.includes("hidden instruction") ||
        normalized.includes("hidden prompt") ||
        normalized.includes("per the developer") ||
        normalized.includes("according to the developer")
      );
    })
    .join("\n")
    .replace(/\b(?:per|according to) the (?:developer|system)[^。.!\n]*(?:[。.!]|$)/gi, "")
    .replace(/开发者(?:提示|指令|消息)[^。\n]*(?:。|$)/g, "")
    .replace(/系统(?:提示词|指令)[^。\n]*(?:。|$)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned;
}
