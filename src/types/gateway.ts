export type Role = "USER" | "ADMIN";
export type UserGroup = "NORMAL" | "VIP";
export type MessageRole = "USER" | "ASSISTANT" | "SYSTEM";
export type GenerationMode = "CHAT" | "IMAGE";
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";
export type ReasoningParamMode = "disabled" | "chat" | "responses";
export type SystemPromptMode = "default" | "append" | "custom" | "off";
export type EasyPayMethod = "alipay" | "wxpay";
export type EasyPayDisplayMode = "qrcode" | "popup";
export type AttachmentKind = "TEXT" | "DOCUMENT" | "SPREADSHEET" | "IMAGE" | "ARCHIVE" | "FILE";
export type MessageGenerationStatus = "running" | "done" | "error" | "stopped";

export type ToolEventView = {
  detail?: string;
  finishedAt?: number;
  id: string;
  label: string;
  startedAt: number;
  status: "running" | "done" | "skipped" | "error";
  type:
    | "router"
    | "attachments"
    | "web_search"
    | "file_analysis"
    | "context_compression"
    | "generation"
    | "usage"
    | "image";
};

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
  cachedInputCentsPerMillionTokens: number;
  outputCentsPerMillionTokens: number;
  contextWindowTokens: number;
  maxContextWindowTokens: number;
  contextNote: string;
  source: "default" | "upstream";
  enabled: boolean;
  supportsReasoning: boolean;
};

export type ChatModelDisplayConfig = {
  contextNote?: string;
  label?: string;
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
  userGroup: UserGroup;
  active: boolean;
  emailVerified: boolean;
  aiStylePrompt: string;
  monthlyCostLimitCents: number;
  quotaResetAt: string;
};

export type UserApiKeyView = {
  id: string;
  name: string;
  keyPrefix: string;
  active: boolean;
  lastUsedAt?: string | null;
  createdAt: string;
};

export type PublicAuthSettingsView = {
  registrationEnabled: boolean;
  registrationRequireEmailVerification: boolean;
};

export type PublicPaymentSettingsView = {
  easyPayEnabled: boolean;
  easyPayDisplayMode: EasyPayDisplayMode;
  easyPayMethods: EasyPayMethod[];
  easyPayBalanceCentsPerYuan: number;
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
  generationStatus?: MessageGenerationStatus;
  streamStatus?: string | null;
  toolEvents?: ToolEventView[];
  processStartedAt?: number | null;
  processFinishedAt?: number | null;
  model?: string | null;
  mode: GenerationMode;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens: number;
  reasoningTokens: number;
  usageSource: string;
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

export type SharedMessageView = {
  id: string;
  conversationId: string;
  role: Exclude<MessageRole, "SYSTEM">;
  content: string;
  imageUrl?: string | null;
  model?: string | null;
  mode: GenerationMode;
  createdAt: string;
  attachments?: AttachmentView[];
  webSources?: WebSearchSource[];
};

export type SharedConversationView = {
  id: string;
  title: string;
  model: string;
  mode: GenerationMode;
  createdAt: string;
  updatedAt: string;
  sharedAt: string;
  messages: SharedMessageView[];
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
  chatModelDisplay: Record<string, ChatModelDisplayConfig>;
  chatModels: ChatModelView[];
  enabledChatModelIds: string[];
  imageModelId: string;
  defaultReasoningEffort: ReasoningEffort;
  reasoningParamMode: ReasoningParamMode;
  contextCompressionEnabled: boolean;
  contextCompressionThresholdPercent: number;
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
  registrationEnabled: boolean;
  registrationRequireEmailVerification: boolean;
  registrationDefaultCostLimitCents: number;
  smtpEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
  smtpHasPassword: boolean;
  smtpPasswordPreview: string;
  smtpFromEmail: string;
  smtpFromName: string;
  smtpSecure: boolean;
  smtpStartTls: boolean;
  easyPayEnabled: boolean;
  easyPayAllowRefund: boolean;
  easyPayDisplayMode: EasyPayDisplayMode;
  easyPayMethods: EasyPayMethod[];
  easyPayBalanceCentsPerYuan: number;
  easyPayPid: string;
  easyPayHasKey: boolean;
  easyPayKeyPreview: string;
  easyPayApiBaseUrl: string;
  easyPayAlipayChannelId: string;
  easyPayWxpayChannelId: string;
  easyPayNotifyPath: string;
  easyPayReturnPath: string;
  updatedAt: string;
};
