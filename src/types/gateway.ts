export type Role = "USER" | "ADMIN";
export type UserGroup = "NORMAL" | "VIP";
export type MessageRole = "USER" | "ASSISTANT" | "SYSTEM";
export type GenerationMode = "CHAT" | "IMAGE";
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";
export type ReasoningParamMode = "disabled" | "chat" | "responses";
export type SystemPromptMode = "default" | "append" | "custom" | "off";
export type EasyPayMethod = "alipay" | "wxpay";
export type EasyPayDisplayMode = "qrcode" | "popup";
export type PaymentOrderStatus = "PENDING" | "PAID" | "FAILED" | "CLOSED" | string;
export type AttachmentKind = "TEXT" | "DOCUMENT" | "SPREADSHEET" | "IMAGE" | "ARCHIVE" | "FILE";
export type MessageGenerationStatus = "running" | "done" | "error" | "stopped";

export type EasyPayAmountTierView = {
  amountCents: number;
  balanceCents: number;
};

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
    | "memory"
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
  cachedInputCentsPerMillionTokens?: number;
  contextNote?: string;
  inputCentsPerMillionTokens?: number;
  label?: string;
  outputCentsPerMillionTokens?: number;
};

export type UsageSummary = {
  windowStart: string;
  windowEnd: string;
  tokensUsed: number;
  messagesUsed: number;
  costUsedCents: number;
  remainingCostCents: number;
  monthlyCostLimitCents: number;
  subscriptionCostUsedCents: number;
  subscriptionRemainingCostCents: number;
  aiPointsBalanceCents: number;
  aiPointsCostUsedCents: number;
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
  aiPointsBalanceCents: number;
  monthlyCostLimitCents: number;
  quotaNextResetAt: string;
  quotaResetAt: string;
  sessionId?: string;
};

export type UserSessionView = {
  id: string;
  active: boolean;
  current: boolean;
  deviceLabel: string;
  userAgent: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt?: string | null;
  revokedReason: string;
};

export type AuthEventView = {
  id: string;
  email: string;
  type: string;
  success: boolean;
  message: string;
  userAgent: string;
  deviceLabel: string;
  createdAt: string;
};

export type UserApiKeyView = {
  id: string;
  name: string;
  keyPrefix: string;
  apiKey?: string | null;
  canReveal: boolean;
  active: boolean;
  lastUsedAt?: string | null;
  createdAt: string;
};

export type UserMemoryView = {
  id: string;
  content: string;
  projectId?: string | null;
  projectName?: string | null;
  source: string;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
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
  easyPayAmountTiers: EasyPayAmountTierView[];
};

export type PaymentOrderView = {
  id: string;
  provider: string;
  method: string;
  status: PaymentOrderStatus;
  outTradeNo: string;
  providerTradeNo?: string | null;
  subject: string;
  amountCents: number;
  balanceCents: number;
  paidAt?: string | null;
  createdAt: string;
  updatedAt: string;
  userId?: string;
  userEmail?: string;
  userName?: string;
};

export type PaymentOrderSummaryView = {
  orders: number;
  paidOrders: number;
  pendingOrders: number;
  totalAmountCents: number;
  paidAmountCents: number;
  paidBalanceCents: number;
};

export type SiteSettingsView = {
  siteName: string;
  siteUrl: string;
};

export type ConversationSummary = {
  id: string;
  title: string;
  projectId?: string | null;
  projectName?: string | null;
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
  projectId?: string | null;
  projectName?: string | null;
  kind: AttachmentKind;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  extractedText?: string | null;
  temporary?: boolean;
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
  activeSessionCount: number;
  createdAt: string;
  lastLoginAt?: string | null;
  lastSeenAt?: string | null;
  updatedAt: string;
  usage: UsageSummary;
};

export type AdminUsageRecordView = {
  id: string;
  apiKeyLabel?: string | null;
  cachedPromptTokens: number;
  completionTokens: number;
  conversationId?: string | null;
  conversationTitle?: string | null;
  createdAt: string;
  durationMs?: number | null;
  endpoint: string;
  estimatedCostCents: number;
  firstTokenLatencyMs?: number | null;
  messageId?: string | null;
  mode: GenerationMode;
  model: string;
  promptTokens: number;
  apiKeyPrefix?: string | null;
  billingMode: string;
  reasoningEffort: string;
  reasoningTokens: number;
  requestKind: string;
  sourceLabel: string;
  surface: string;
  totalTokens: number;
  usageSource: string;
  userAgent: string;
  userEmail: string;
  userId: string;
  userName: string;
};

export type AdminUsageSummaryView = {
  apiCalls: number;
  avgDurationMs?: number | null;
  avgFirstTokenLatencyMs?: number | null;
  cachedPromptTokens: number;
  cacheRate: number;
  chatCalls: number;
  completionTokens: number;
  costCents: number;
  imageCalls: number;
  promptTokens: number;
  reasoningTokens: number;
  records: number;
  returnedRecords: number;
  taskCalls: number;
  totalTokens: number;
};

export type AdminUsageFilterOptionsView = {
  apiKeys: Array<{
    id: string;
    label: string;
    userLabel: string;
  }>;
  models: string[];
  users: Array<{
    id: string;
    label: string;
  }>;
};

export type AiSettingsView = {
  siteName: string;
  siteUrl: string;
  apiBaseUrl: string;
  hasApiKey: boolean;
  apiKeyPreview: string;
  orgId: string;
  gpt54ProApiBaseUrl: string;
  gpt54ProHasApiKey: boolean;
  gpt54ProApiKeyPreview: string;
  gpt54ProOrgId: string;
  mockResponses: boolean;
  chatModelMap: Record<string, string>;
  chatModelDisplay: Record<string, ChatModelDisplayConfig>;
  chatModels: ChatModelView[];
  enabledChatModelIds: string[];
  imageModelId: string;
  defaultReasoningEffort: ReasoningEffort;
  reasoningParamMode: ReasoningParamMode;
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
  easyPayAmountTiers: EasyPayAmountTierView[];
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
