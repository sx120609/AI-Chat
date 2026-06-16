import type {
  ChatModelView,
  MessageView,
  ReasoningEffort,
  SiteSettingsView,
  ToolEventView,
  UsageSummary,
  UserView,
  EasyPayMethod,
  PublicPaymentSettingsView
} from "@/types/gateway";

export type ChatShellProps = {
  initialUser: UserView;
  initialSiteSettings: SiteSettingsView;
  initialUsage: UsageSummary;
  initialModels: ChatModelView[];
  initialDefaultReasoningEffort: ReasoningEffort;
  initialPaymentSettings: PublicPaymentSettingsView;
  initialWebSearchEnabled: boolean;
};

export type SseEvent = {
  event: string;
  data: Record<string, unknown>;
};

export type ContextStats = {
  promptTokensEstimate: number;
  historyMessageCount: number;
  omittedHistoryMessageCount: number;
  contextWindowTokens: number;
  longContextThresholdTokens: number;
  reserveTokens: number;
  longContextThresholdExceeded: boolean;
  contextWindowPercent: number;
  compressedHistoryMessageCount: number;
  compressedSummaryTokens: number;
};

export type ShareNotice = {
  description?: string;
  title: string;
  tone: "success" | "error";
  url?: string;
};

export type ChatProjectView = {
  id: string;
  name: string;
  instructions: string;
  memoryScope: string;
  defaultModel: string;
  createdAt: string;
  updatedAt: string;
};

export type InlineProcessView = {
  events: ToolEventView[];
  expanded: boolean;
  finishedAt: number | null;
  now: number;
  onExpandedChange: (expanded: boolean) => void;
  startedAt: number;
  status: string;
};

export type ComposerDraftState = {
  focusToken: number;
  text: string;
};

export type ToolEventUpdate = Omit<ToolEventView, "finishedAt" | "startedAt"> &
  Partial<Pick<ToolEventView, "finishedAt" | "startedAt">>;

export type InFlightChatGeneration = {
  assistantMessage: MessageView;
  contextStats: ContextStats | null;
  conversationId: string | null;
  processFinishedAt: number | null;
  processStartedAt: number;
  streamStatus: string;
  toolEvents: ToolEventView[];
};

export const PAYMENT_AMOUNTS_CENTS = [100, 500, 1000, 2000, 5000];

export const PAYMENT_METHOD_LABELS: Record<EasyPayMethod, string> = {
  alipay: "支付宝",
  wxpay: "微信支付"
};

export const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 96;
export const COMPOSER_TEXTAREA_MIN_HEIGHT = 36;
export const COMPOSER_TEXTAREA_DESKTOP_MIN_HEIGHT = 36;
export const COMPOSER_TEXTAREA_MAX_HEIGHT = 152;
export const COMPOSER_FULLSCREEN_THRESHOLD = 92;
export const GENERATION_THINKING_LABEL = "思考中";
export const GENERATION_THINKING_DETAIL = "正在思考并组织回答";
export const GENERATION_THINKING_STATUS = "思考中，正在组织回答...";
export const GENERATION_STREAMING_DETAIL = "正在组织回答并输出内容";
export const GENERATION_STREAMING_STATUS = "正在组织回答...";
export const STREAM_RENDER_INTERVAL_MS = 48;
