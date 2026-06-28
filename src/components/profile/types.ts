import type {
  ChatModelView,
  AuthEventView,
  PaymentOrderSummaryView,
  PaymentOrderView,
  PublicPaymentSettingsView,
  SiteSettingsView,
  UsageSummary,
  UserApiKeyView,
  UserMemoryView,
  UserSessionView,
  UserView
} from "@/types/gateway";
export type ProfileCenterProps = {
  apiModels: ChatModelView[];
  initialUser: UserView;
  initialUsage: UsageSummary;
  initialPaymentSettings: PublicPaymentSettingsView;
  siteSettings: SiteSettingsView;
};

export type ApiKeysPayload = {
  canCreate: boolean;
  keys: UserApiKeyView[];
};

export type MemoriesPayload = {
  memories: UserMemoryView[];
};

export type SharedLinkView = {
  id: string;
  token: string;
  conversationId: string;
  title: string;
  model: string;
  mode: string;
  conversationUpdatedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type SharedLinksPayload = {
  links: SharedLinkView[];
};

export type ArchivedConversationView = {
  _count?: {
    messages: number;
  };
  archivedAt?: string | null;
  createdAt: string;
  id: string;
  mode: string;
  model: string;
  projectId?: string | null;
  projectName?: string | null;
  title: string;
  updatedAt: string;
};

export type ArchivedConversationsPayload = {
  conversations: ArchivedConversationView[];
};

export type FileLibraryItem = {
  id: string;
  projectId?: string | null;
  projectName?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  kind: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  temporary?: boolean;
  conversationTitle?: string | null;
  conversationArchivedAt?: string | null;
  createdAt: string;
};

export type FileLibraryPayload = {
  files: FileLibraryItem[];
  hasMore?: boolean;
  limit?: number;
  offset?: number;
  total?: number;
};

export type UsageBucketView = {
  cachedPromptTokens: number;
  completionTokens: number;
  costCents: number;
  key: string;
  label: string;
  promptTokens: number;
  reasoningTokens: number;
  records: number;
  totalTokens: number;
};

export type UsageBreakdownPayload = {
  byApiKey?: UsageBucketView[];
  byDay: UsageBucketView[];
  byMode: UsageBucketView[];
  byModel: UsageBucketView[];
  byMonth: UsageBucketView[];
  bySurface: UsageBucketView[];
  generatedAt: string;
  recentRecords: Array<{
    apiKeyLabel?: string | null;
    createdAt: string;
    estimatedCostCents: number;
    id: string;
    mode: string;
    model: string;
    surface: string;
    totalTokens: number;
    usageSource: string;
  }>;
  totals: {
    costCents: number;
    records: number;
    totalTokens: number;
  };
};

export type UserProjectView = {
  counts?: {
    attachments: number;
    conversations: number;
    memories: number;
  };
  id: string;
  name: string;
  instructions: string;
  memoryScope: string;
  defaultModel: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectsPayload = {
  projects: UserProjectView[];
};

export type SecurityPayload = {
  events: AuthEventView[];
  sessions: UserSessionView[];
};

export type PaymentsPayload = {
  orders: PaymentOrderView[];
  summary: PaymentOrderSummaryView;
};

export type ProfileTab =
  | "overview"
  | "personalization"
  | "memory"
  | "data"
  | "security"
  | "api";

export type DataControlAction =
  | "archive_chats"
  | "delete_account"
  | "delete_chats"
  | "deactivate_account"
  | "clear_shared_links";

export type InstructionPreset = "concise" | "professional" | "teaching" | "code" | "life";
export type ApiGuideTool = "codex" | "opencode" | "claude-router";
export type ApiGuideOs = "unix" | "windows";

export type SelectOption<T extends string> = {
  label: string;
  value: T;
};
