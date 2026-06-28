import type {
  AdminUsageFilterOptionsView,
  AdminUsageRecordView,
  AdminUsageSummaryView,
  ChatModelDisplayConfig,
  EasyPayDisplayMode,
  EasyPayMethod,
  PaymentOrderSummaryView,
  PaymentOrderView,
  ReasoningEffort,
  ReasoningParamMode,
  Role,
  SystemPromptMode,
  UserGroup,
  UserView
} from "@/types/gateway";

export type AdminDashboardProps = {
  currentUser: UserView;
};

export type CreateForm = {
  email: string;
  name: string;
  password: string;
  role: Role;
  userGroup: UserGroup;
  aiPointsBalanceCents: number;
  monthlyCostLimitCents: number;
};

export type SettingsForm = {
  siteName: string;
  siteUrl: string;
  apiBaseUrl: string;
  apiKey: string;
  orgId: string;
  mockResponses: boolean;
  clearApiKey: boolean;
  chatModelMap: Record<string, string>;
  chatModelDisplay: Record<string, ChatModelDisplayConfig>;
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
  smtpPassword: string;
  clearSmtpPassword: boolean;
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
  easyPayKey: string;
  clearEasyPayKey: boolean;
  easyPayApiBaseUrl: string;
  easyPayAlipayChannelId: string;
  easyPayWxpayChannelId: string;
};

export type AdminTab = "access" | "models" | "prompts" | "tools" | "mail" | "payment" | "users" | "usage";

export type DiagnosticCheck = {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
};

export type DiagnosticsResult = {
  ok: boolean;
  checks: DiagnosticCheck[];
  modelCount: number;
  chatModelCount: number;
  sample: string[];
};

export type AdminUsagePayload = {
  filterOptions: AdminUsageFilterOptionsView;
  generatedAt: string;
  limit: number;
  page: number;
  pageSize: number;
  records: AdminUsageRecordView[];
  summary: AdminUsageSummaryView;
  totalPages: number;
};

export type AdminPaymentsPayload = {
  filterOptions: {
    users: Array<{
      id: string;
      label: string;
    }>;
  };
  orders: PaymentOrderView[];
  summary: PaymentOrderSummaryView;
};

export type UsageFilterState = {
  apiKey: string;
  days: string;
  model: string;
  page: string;
  pageSize: string;
  query: string;
  surface: string;
  userId: string;
};
