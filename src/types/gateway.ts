export type Role = "USER" | "ADMIN";
export type MessageRole = "USER" | "ASSISTANT" | "SYSTEM";
export type GenerationMode = "CHAT" | "IMAGE";
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";
export type ReasoningParamMode = "disabled" | "chat" | "responses";
export type SystemPromptMode = "default" | "append" | "custom" | "off";
export type AttachmentKind = "TEXT" | "DOCUMENT" | "SPREADSHEET" | "IMAGE" | "ARCHIVE";

export type WebSearchSource = {
  displayUrl: string;
  snippet: string;
  title: string;
  url: string;
};

export type ChatModelView = {
  id: string;
  label: string;
  upstreamId: string;
  inputCentsPerMillionTokens: number;
  outputCentsPerMillionTokens: number;
  contextWindowTokens: number;
  contextNote: string;
  source: "default" | "upstream";
  enabled: boolean;
  supportsReasoning: boolean;
};

export type UsageSummary = {
  windowStart: string;
  tokensUsed: number;
  messagesUsed: number;
  costUsedCents: number;
  remainingCostCents: number;
  monthlyCostLimitCents: number;
};

export type UserView = {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  monthlyCostLimitCents: number;
  quotaResetAt: string;
};

export type SiteSettingsView = {
  siteName: string;
  siteUrl: string;
};

export type ConversationSummary = {
  id: string;
  title: string;
  model: string;
  mode: GenerationMode;
  pinned: boolean;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: {
    messages: number;
  };
};

export type MessageView = {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  reasoningContent?: string | null;
  imageUrl?: string | null;
  model?: string | null;
  mode: GenerationMode;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostCents: number;
  createdAt: string;
  attachments?: AttachmentView[];
  webSources?: WebSearchSource[];
  pending?: boolean;
};

export type AttachmentView = {
  id: string;
  kind: AttachmentKind;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  extractedText?: string | null;
  previewUrl?: string;
  createdAt: string;
};

export type AdminUserView = UserView & {
  createdAt: string;
  updatedAt: string;
  usage: UsageSummary;
};

export type AiSettingsView = {
  siteName: string;
  siteUrl: string;
  apiBaseUrl: string;
  hasApiKey: boolean;
  apiKeyPreview: string;
  orgId: string;
  mockResponses: boolean;
  chatModelMap: Record<string, string>;
  chatModels: ChatModelView[];
  enabledChatModelIds: string[];
  imageModelId: string;
  defaultReasoningEffort: ReasoningEffort;
  reasoningParamMode: ReasoningParamMode;
  longContextThresholdTokens: number;
  systemPromptMode: SystemPromptMode;
  customSystemPrompt: string;
  modelSystemPrompts: Record<string, string>;
  codeInterpreterEnabled: boolean;
  codeInterpreterSandbox: string;
  codeInterpreterAllowPackageInstall: boolean;
  codeInterpreterPipIndexUrl: string;
  webSearchEnabled: boolean;
  webSearchProvider: string;
  webSearchMaxResults: number;
  hasGoogleSearchApiKey: boolean;
  googleSearchApiKeyPreview: string;
  googleSearchCx: string;
  updatedAt: string;
};
