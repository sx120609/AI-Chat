"use client";

import {
  Archive,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  CreditCard,
  ExternalLink,
  File as FileIcon,
  FileArchive,
  FileText,
  FolderOpen,
  Gauge,
  Image as ImageIcon,
  Loader2,
  LogOut,
  Maximize2,
  Menu,
  MessageSquarePlus,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  RotateCcw,
  Search,
  Send,
  Share2,
  Shield,
  Sparkles,
  Square,
  Table2,
  Trash2,
  UserRound,
  X
} from "lucide-react";
import {
  Children,
  type DragEvent,
  KeyboardEvent,
  type ReactElement,
  type ReactNode,
  isValidElement,
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { sanitizeIdentityLeak, sanitizeReasoningContent } from "@/lib/identity";
import { prepareMarkdownForRendering } from "@/lib/markdown";
import { DEFAULT_REASONING_EFFORT, REASONING_EFFORTS } from "@/lib/models";
import { parsePersonalizationSettings } from "@/lib/personalization";
import { formatCents, formatNumber } from "@/lib/format";
import { formatPromptClock } from "@/lib/system-prompt";
import { SiteConfirmDialog } from "@/components/site-dialog";
import { SiteLogo } from "@/components/site-logo";
import type {
  AttachmentView,
  ChatModelView,
  ConversationSummary,
  GenerationMode,
  MessageView,
  ReasoningEffort,
  SiteSettingsView,
  ToolEventView,
  UsageSummary,
  UserView,
  EasyPayMethod,
  PublicPaymentSettingsView
} from "@/types/gateway";

type ChatShellProps = {
  initialUser: UserView;
  initialSiteSettings: SiteSettingsView;
  initialUsage: UsageSummary;
  initialModels: ChatModelView[];
  initialDefaultReasoningEffort: ReasoningEffort;
  initialPaymentSettings: PublicPaymentSettingsView;
  initialWebSearchEnabled: boolean;
};

type SseEvent = {
  event: string;
  data: Record<string, unknown>;
};

type ContextStats = {
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

type ShareNotice = {
  description?: string;
  title: string;
  tone: "success" | "error";
  url?: string;
};

type ChatProjectView = {
  id: string;
  name: string;
  instructions: string;
  memoryScope: string;
  defaultModel: string;
  createdAt: string;
  updatedAt: string;
};

const PAYMENT_AMOUNTS_CENTS = [100, 500, 1000, 2000, 5000];
const PAYMENT_METHOD_LABELS: Record<EasyPayMethod, string> = {
  alipay: "支付宝",
  wxpay: "微信支付"
};

function formatPaymentYuan(amountCents: number) {
  return `¥${(amountCents / 100).toFixed(2)}`;
}

function calculatePaymentBalanceCents(amountCents: number, balanceCentsPerYuan: number) {
  const rate = Number.isFinite(balanceCentsPerYuan) ? balanceCentsPerYuan : 100;

  return Math.max(1, Math.round((Math.max(1, amountCents) * rate) / 100));
}

type ToolEventUpdate = Omit<ToolEventView, "finishedAt" | "startedAt"> &
  Partial<Pick<ToolEventView, "finishedAt" | "startedAt">>;

type InFlightChatGeneration = {
  assistantMessage: MessageView;
  contextStats: ContextStats | null;
  conversationId: string | null;
  processFinishedAt: number | null;
  processStartedAt: number;
  streamStatus: string;
  toolEvents: ToolEventView[];
};

type InlineProcessView = {
  events: ToolEventView[];
  expanded: boolean;
  finishedAt: number | null;
  now: number;
  onExpandedChange: (expanded: boolean) => void;
  startedAt: number;
  status: string;
};

type ComposerDraftState = {
  focusToken: number;
  text: string;
};

function createLocalConversationKey() {
  return `local-conversation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseSseBlock(block: string): SseEvent | null {
  const lines = block.split(/\r?\n/);
  let event = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  try {
    return {
      event,
      data: JSON.parse(dataLines.join("\n")) as Record<string, unknown>
    };
  } catch {
    return null;
  }
}

function usagePercent(used: number, limit: number) {
  if (limit <= 0) {
    return 0;
  }

  return Math.min(100, Math.round((used / limit) * 100));
}

const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 96;
const COMPOSER_TEXTAREA_MIN_HEIGHT = 36;
const COMPOSER_TEXTAREA_DESKTOP_MIN_HEIGHT = 36;
const COMPOSER_TEXTAREA_MAX_HEIGHT = 152;
const COMPOSER_FULLSCREEN_THRESHOLD = 92;
const GENERATION_THINKING_LABEL = "思考中";
const GENERATION_THINKING_DETAIL = "正在思考并组织回答";
const GENERATION_THINKING_STATUS = "思考中，正在组织回答...";
const GENERATION_STREAMING_DETAIL = "正在组织回答并输出内容";
const GENERATION_STREAMING_STATUS = "正在组织回答...";

function composerTextareaMinHeight() {
  if (typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches) {
    return COMPOSER_TEXTAREA_DESKTOP_MIN_HEIGHT;
  }

  return COMPOSER_TEXTAREA_MIN_HEIGHT;
}

function formatElapsedDuration(milliseconds: number) {
  if (milliseconds > 0 && milliseconds < 1000) {
    return "<1s";
  }

  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  }

  return `${seconds}s`;
}

function createToolEvent(
  event: ToolEventUpdate,
  now = Date.now()
): ToolEventView {
  return {
    ...event,
    finishedAt: event.finishedAt ?? (event.status === "running" ? undefined : now),
    startedAt: event.startedAt ?? now
  };
}

function mergeToolEvent(
  current: ToolEventView[],
  event: ToolEventUpdate,
  now = Date.now()
) {
  const index = current.findIndex((item) => item.id === event.id);

  if (index < 0) {
    return [...current, createToolEvent(event, now)];
  }

  return current.map((item) =>
    item.id === event.id
      ? {
          ...item,
          ...event,
          finishedAt:
            event.finishedAt ??
            (event.status === "running"
              ? undefined
              : item.finishedAt ?? now),
          startedAt: event.startedAt ?? item.startedAt
        }
      : item
  );
}
const STREAM_RENDER_INTERVAL_MS = 48;

function emptyMessage(
  role: "USER" | "ASSISTANT",
  content: string,
  mode: GenerationMode,
  attachments: AttachmentView[] = []
): MessageView {
  const now = new Date().toISOString();
  const id = `local-${role.toLowerCase()}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return {
    id,
    conversationId: "local",
    role,
    content,
    reasoningContent: null,
    mode,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedPromptTokens: 0,
    reasoningTokens: 0,
    usageSource: "estimated",
    estimatedCostCents: 0,
    createdAt: now,
    attachments,
    pending: true
  };
}

function isLocalMessage(message: MessageView) {
  return message.id.startsWith("local-") || message.conversationId === "local";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function conversationGroupLabel(conversation: ConversationSummary) {
  if (conversation.pinned) {
    return "固定";
  }

  const today = startOfLocalDay(new Date());
  const updated = startOfLocalDay(new Date(conversation.updatedAt));
  const diffDays = Math.round((today - updated) / 86_400_000);

  if (diffDays <= 0) {
    return "今天";
  }

  if (diffDays === 1) {
    return "昨天";
  }

  if (diffDays <= 7) {
    return "最近 7 天";
  }

  if (diffDays <= 30) {
    return "最近 30 天";
  }

  return "更早";
}

function groupConversations(conversations: ConversationSummary[]) {
  const order = ["固定", "今天", "昨天", "最近 7 天", "最近 30 天", "更早"];
  const groups = new Map<string, ConversationSummary[]>();

  for (const conversation of conversations) {
    const label = conversationGroupLabel(conversation);
    const group = groups.get(label);

    if (group) {
      group.push(conversation);
    } else {
      groups.set(label, [conversation]);
    }
  }

  return order
    .map((label) => ({
      conversations: groups.get(label) ?? [],
      label
    }))
    .filter((group) => group.conversations.length > 0);
}

function messageProcessStatus(message: MessageView) {
  if (message.streamStatus) {
    return message.streamStatus;
  }

  if (message.generationStatus === "running") {
    return GENERATION_THINKING_STATUS;
  }

  if (message.generationStatus === "error") {
    return "上游调用失败。";
  }

  if (message.generationStatus === "stopped") {
    return "连接已中断，已保存部分内容。";
  }

  return "已完成。";
}

function shouldShowInlineError(message: string) {
  const normalized = message.trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  return !(
    normalized.includes("流式连接中断") ||
    normalized.includes("network error") ||
    normalized.includes("生图连接中断") ||
    normalized.includes("生图失败") ||
    normalized.includes("上游 api 错误") ||
    normalized.includes("gateway time-out") ||
    normalized.includes("后台生图仍在进行") ||
    normalized.includes("图片可能仍在后台生成")
  );
}

function latestMessageProcess(messages: MessageView[]) {
  return [...messages]
    .reverse()
    .find(
      (message) =>
        message.role === "ASSISTANT" &&
        Boolean(message.processStartedAt) &&
        Boolean(message.toolEvents?.length)
    );
}

function useEventCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  return useCallback((...args: Args) => callbackRef.current(...args), []);
}

function resolveChatModelId(value: string, models: ChatModelView[]) {
  return models.find((model) => model.id === value || model.upstreamId === value)?.id ?? "";
}

export function ChatShell({
  initialDefaultReasoningEffort,
  initialModels,
  initialPaymentSettings,
  initialSiteSettings,
  initialUser,
  initialUsage,
  initialWebSearchEnabled
}: ChatShellProps) {
  const personalizationSettings = useMemo(
    () => parsePersonalizationSettings(initialUser.aiStylePrompt),
    [initialUser.aiStylePrompt]
  );
  const securityModeDefault = personalizationSettings.toolPreferences.securityMode;
  const defaultTemporaryMode = personalizationSettings.temporaryChatDefault || securityModeDefault;
  const defaultModel =
    resolveChatModelId(personalizationSettings.toolPreferences.defaultModel, initialModels) ||
    initialModels[0]?.id ||
    "";
  const [user] = useState(initialUser);
  const [siteSettings, setSiteSettings] = useState(initialSiteSettings);
  const [usage, setUsage] = useState(initialUsage);
  const [paymentSettings, setPaymentSettings] = useState(initialPaymentSettings);
  const [chatModels, setChatModels] = useState(initialModels);
  const [projects, setProjects] = useState<ChatProjectView[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeLocalConversationKey, setActiveLocalConversationKey] = useState(
    createLocalConversationKey
  );
  const [conversationSearch, setConversationSearch] = useState("");
  const [renamingConversationId, setRenamingConversationId] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const [openConversationMenuId, setOpenConversationMenuId] = useState<string | null>(null);
  const [deleteConversationTarget, setDeleteConversationTarget] =
    useState<ConversationSummary | null>(null);
  const [deletingConversationId, setDeletingConversationId] = useState<string | null>(null);
  const [deleteMessageTarget, setDeleteMessageTarget] = useState<MessageView | null>(null);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [sharingConversationId, setSharingConversationId] = useState<string | null>(null);
  const [shareNotice, setShareNotice] = useState<ShareNotice | null>(null);
  const [loadingConversationId, setLoadingConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [imageToolEnabled, setImageToolEnabled] = useState(false);
  const [sourceImageMessage, setSourceImageMessage] = useState<MessageView | null>(null);
  const [webSearchAvailable, setWebSearchAvailable] = useState(initialWebSearchEnabled);
  const [webSearchEnabledForMessage, setWebSearchEnabledForMessage] = useState(
    initialWebSearchEnabled &&
      personalizationSettings.apps.webSearch &&
      personalizationSettings.toolPreferences.webSearchDefault &&
      !securityModeDefault
  );
  const [temporaryChatEnabled, setTemporaryChatEnabled] = useState(defaultTemporaryMode);
  const [memoryWriteDisabledForConversation, setMemoryWriteDisabledForConversation] =
    useState(false);
  const [model, setModel] = useState<string>(defaultModel);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(
    personalizationSettings.toolPreferences.defaultReasoningEffort || initialDefaultReasoningEffort
  );
  const [composerDraft, setComposerDraft] = useState<ComposerDraftState>({
    focusToken: 0,
    text: ""
  });
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentView[]>([]);
  const [editingMessage, setEditingMessage] = useState<MessageView | null>(null);
  const [error, setError] = useState("");
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [runningGenerationKeys, setRunningGenerationKeys] = useState<string[]>([]);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [streamStatus, setStreamStatus] = useState("");
  const [toolEvents, setToolEvents] = useState<ToolEventView[]>([]);
  const [processTimelineExpanded, setProcessTimelineExpanded] = useState(true);
  const [processMessageId, setProcessMessageId] = useState<string | null>(null);
  const [processStartedAt, setProcessStartedAt] = useState<number | null>(null);
  const [processFinishedAt, setProcessFinishedAt] = useState<number | null>(null);
  const [processNow, setProcessNow] = useState(() => Date.now());
  const [lastContextStats, setLastContextStats] = useState<ContextStats | null>(null);
  const activeConversationKey = activeConversationId ?? activeLocalConversationKey;
  const activeConversationKeyRef = useRef(activeConversationKey);
  const activeConversationIdRef = useRef<string | null>(null);
  const abortControllersRef = useRef(new Map<string, AbortController>());
  const autoScrollRef = useRef(true);
  const conversationListRequestSeqRef = useRef(0);
  const conversationLoadRequestSeqRef = useRef(0);
  const inFlightChatsRef = useRef(new Map<string, InFlightChatGeneration>());
  const initialConversationsLoadedRef = useRef(false);
  const fileDragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const headerControlsRef = useRef<HTMLDivElement | null>(null);
  const messageScrollRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const quotaBlocked = usage.remainingCostCents <= 0;
  const imageGenerationAvailable =
    personalizationSettings.toolPreferences.imageGenerationEnabled && !securityModeDefault;
  const fileAnalysisAvailable =
    personalizationSettings.apps.fileLibrary &&
    personalizationSettings.toolPreferences.fileAnalysisEnabled &&
    !securityModeDefault;
  const webSearchToolAvailable =
    webSearchAvailable && personalizationSettings.apps.webSearch && !securityModeDefault;
  const runningGenerationKeySet = useMemo(
    () => new Set(runningGenerationKeys),
    [runningGenerationKeys]
  );
  const loading = runningGenerationKeySet.has(activeConversationKey);
  const conversationSwitching = Boolean(
    activeConversationId && loadingConversationId === activeConversationId
  );

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId),
    [activeConversationId, conversations]
  );
  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projects]
  );
  const activeModel = useMemo(
    () => chatModels.find((item) => item.id === model) ?? chatModels[0],
    [chatModels, model]
  );
  const messageModelLabels = useMemo(() => {
    const labels = new Map<string, string>();

    for (const item of chatModels) {
      labels.set(item.id, item.label);
      labels.set(item.upstreamId, item.label);
    }

    labels.set("image2", "image2");
    return labels;
  }, [chatModels]);
  const activeReasoningEffort = useMemo(
    () => REASONING_EFFORTS.find((item) => item.id === reasoningEffort) ?? REASONING_EFFORTS[0],
    [reasoningEffort]
  );
  const webSearchProvider = "duckduckgo";
  const webSearchProviderLabel = "DuckDuckGo";
  const groupedConversations = useMemo(() => groupConversations(conversations), [conversations]);
  const inlineProcessMessageId = useMemo(() => {
    if (!processStartedAt || !processMessageId) {
      return null;
    }

    return messages.some((message) => message.id === processMessageId) ? processMessageId : null;
  }, [messages, processMessageId, processStartedAt]);
  const sidebarHeaderButtonClass =
    "app-action-button app-glass-control min-h-9 min-w-9 shrink-0 place-items-center rounded-xl text-[color:var(--app-ink-soft)] transition hover:text-[color:var(--claude-ink)] active:scale-95";
  const setComposerText = useCallback((text: string, focus = false) => {
    setComposerDraft((current) => ({
      focusToken: focus ? current.focusToken + 1 : current.focusToken,
      text
    }));
  }, []);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
    activeConversationKeyRef.current = activeConversationKey;
  }, [activeConversationId, activeConversationKey]);

  function markGenerationRunning(conversationKey: string) {
    setRunningGenerationKeys((current) =>
      current.includes(conversationKey) ? current : [...current, conversationKey]
    );
  }

  function markGenerationFinished(conversationKey: string) {
    setRunningGenerationKeys((current) => current.filter((key) => key !== conversationKey));
  }

  function isViewingConversationKey(conversationKey: string) {
    return activeConversationKeyRef.current === conversationKey;
  }

  function syncVisibleProcessState(inFlightChat: InFlightChatGeneration) {
    setLastContextStats(inFlightChat.contextStats);
    setStreamStatus(inFlightChat.streamStatus);
    setToolEvents(inFlightChat.toolEvents);
    setProcessMessageId(inFlightChat.assistantMessage.id);
    setProcessStartedAt(inFlightChat.processStartedAt);
    setProcessFinishedAt(inFlightChat.processFinishedAt);
    setProcessNow(Date.now());
  }

  function storeInFlightChat(conversationKey: string, inFlightChat: InFlightChatGeneration) {
    inFlightChatsRef.current.set(conversationKey, inFlightChat);
  }

  function getInFlightChat(conversationKey: string) {
    return inFlightChatsRef.current.get(conversationKey) ?? null;
  }

  function deleteInFlightChat(conversationKey: string) {
    inFlightChatsRef.current.delete(conversationKey);
  }

  function resolveInFlightConversationKey(currentKey: string, conversationId: string) {
    if (currentKey === conversationId) {
      return conversationId;
    }

    const inFlightChat = inFlightChatsRef.current.get(currentKey);
    const controller = abortControllersRef.current.get(currentKey);

    if (inFlightChat) {
      inFlightChatsRef.current.delete(currentKey);
      inFlightChatsRef.current.set(conversationId, {
        ...inFlightChat,
        conversationId
      });
    }

    if (controller) {
      abortControllersRef.current.delete(currentKey);
      abortControllersRef.current.set(conversationId, controller);
    }

    setRunningGenerationKeys((current) =>
      current.map((key) => (key === currentKey ? conversationId : key))
    );

    if (activeConversationKeyRef.current === currentKey) {
      activeConversationKeyRef.current = conversationId;
      activeConversationIdRef.current = conversationId;
      setActiveConversationId(conversationId);
    }

    return conversationId;
  }

  const refreshMe = useCallback(async () => {
    const response = await fetch("/api/me");

    if (response.ok) {
      const payload = (await response.json()) as {
        usage: UsageSummary;
        siteSettings?: SiteSettingsView;
        chatModels?: ChatModelView[];
        defaultReasoningEffort?: ReasoningEffort;
        paymentSettings?: PublicPaymentSettingsView;
        webSearchEnabled?: boolean;
      };
      setUsage(payload.usage);

      if (payload.siteSettings) {
        setSiteSettings(payload.siteSettings);
      }

      if (payload.chatModels?.length) {
        setChatModels(payload.chatModels);
        setModel((current) => {
          const resolvedCurrent = resolveChatModelId(current, payload.chatModels ?? []);

          return resolvedCurrent || payload.chatModels?.[0]?.id || current;
        });
      }

      if (payload.defaultReasoningEffort) {
        setReasoningEffort(
          (current) => current || payload.defaultReasoningEffort || DEFAULT_REASONING_EFFORT
        );
      }

      if (payload.paymentSettings) {
        setPaymentSettings(payload.paymentSettings);
      }

      if (typeof payload.webSearchEnabled === "boolean") {
        setWebSearchAvailable(payload.webSearchEnabled);

        if (!payload.webSearchEnabled) {
          setWebSearchEnabledForMessage(false);
        }
      }

    }
  }, []);

  const loadProjects = useCallback(async () => {
    const response = await fetch("/api/profile/projects").catch(() => null);
    const payload = response?.ok
      ? ((await response.json().catch(() => null)) as { projects?: ChatProjectView[] } | null)
      : null;

    if (payload?.projects) {
      setProjects(payload.projects);
    }
  }, []);

  const loadConversation = useCallback(async (conversationId: string) => {
    const requestSeq = conversationLoadRequestSeqRef.current + 1;
    conversationLoadRequestSeqRef.current = requestSeq;
    setLoadingConversationId(conversationId);

    try {
      const response = await fetch(`/api/conversations/${conversationId}?context=0`);

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;

        if (requestSeq === conversationLoadRequestSeqRef.current) {
          setError(payload?.error || "加载会话失败。");
        }
        return;
      }

      if (requestSeq !== conversationLoadRequestSeqRef.current) {
        return;
      }

      const payload = (await response.json()) as {
        conversation: ConversationSummary & { messages: MessageView[] };
        context?: ContextStats;
      };

      if (requestSeq !== conversationLoadRequestSeqRef.current) {
        return;
      }

      const inFlightChat = getInFlightChat(payload.conversation.id);
      const restoringInFlightChat =
        inFlightChat && !inFlightChat.processFinishedAt ? inFlightChat : null;
      let messagesWithInFlight = payload.conversation.messages;

      if (restoringInFlightChat) {
        const hasPersistedAssistant = messagesWithInFlight.some(
          (message) => message.id === restoringInFlightChat.assistantMessage.id
        );

        messagesWithInFlight = hasPersistedAssistant
          ? messagesWithInFlight.map((message) =>
              message.id === restoringInFlightChat.assistantMessage.id
                ? restoringInFlightChat.assistantMessage
                : message
            )
          : [...messagesWithInFlight, restoringInFlightChat.assistantMessage];
      }
      const restoredProcessMessage = restoringInFlightChat
        ? null
        : latestMessageProcess(messagesWithInFlight);

      activeConversationIdRef.current = payload.conversation.id;
      activeConversationKeyRef.current = payload.conversation.id;
      setActiveConversationId(payload.conversation.id);
      setActiveProjectId(payload.conversation.projectId ?? "");
      setMessages(messagesWithInFlight);
      setLastContextStats(
        restoringInFlightChat
          ? restoringInFlightChat.contextStats ?? payload.context ?? null
          : payload.context ?? null
      );

      if (restoringInFlightChat) {
        syncVisibleProcessState(restoringInFlightChat);
      } else if (restoredProcessMessage) {
        setStreamStatus(messageProcessStatus(restoredProcessMessage));
        setToolEvents(restoredProcessMessage.toolEvents ?? []);
        setProcessMessageId(restoredProcessMessage.id);
        setProcessStartedAt(restoredProcessMessage.processStartedAt ?? null);
        setProcessFinishedAt(restoredProcessMessage.processFinishedAt ?? null);
        setProcessNow(restoredProcessMessage.processFinishedAt ?? Date.now());
      } else {
        setStreamStatus("");
        setToolEvents([]);
        setProcessMessageId(null);
        setProcessStartedAt(null);
        setProcessFinishedAt(null);
      }

      if (payload.conversation.model && payload.conversation.model !== "image2") {
        setModel(payload.conversation.model);
      }
      setImageToolEnabled(false);
      setSourceImageMessage(null);
      setWebSearchEnabledForMessage(false);
    } catch (loadError) {
      if (requestSeq === conversationLoadRequestSeqRef.current) {
        setError(
          loadError instanceof Error ? `加载会话失败：${loadError.message}` : "加载会话失败。"
        );
      }
    } finally {
      if (requestSeq === conversationLoadRequestSeqRef.current) {
        setLoadingConversationId((current) => (current === conversationId ? null : current));
      }
    }
  }, []);

  const refreshConversations = useCallback(
    async (preferredId?: string, loadFirst = false) => {
      const requestSeq = conversationListRequestSeqRef.current + 1;
      conversationListRequestSeqRef.current = requestSeq;
      const params = new URLSearchParams();

      if (conversationSearch.trim()) {
        params.set("search", conversationSearch.trim());
      }

      const response = await fetch(
        `/api/conversations${params.toString() ? `?${params.toString()}` : ""}`
      );

      if (!response.ok || requestSeq !== conversationListRequestSeqRef.current) {
        return;
      }

      const payload = (await response.json()) as { conversations: ConversationSummary[] };

      if (requestSeq !== conversationListRequestSeqRef.current) {
        return;
      }

      startTransition(() => {
        setConversations(payload.conversations);
      });

      const target = preferredId ?? (loadFirst ? payload.conversations[0]?.id : undefined);

      if (target) {
        await loadConversation(target);
      }
    },
    [conversationSearch, loadConversation]
  );

  useEffect(() => {
    const handle = window.setTimeout(
      () => {
        void refreshConversations(undefined, !initialConversationsLoadedRef.current).finally(() => {
          initialConversationsLoadedRef.current = true;
        });
      },
      conversationSearch.trim() ? 250 : 0
    );

    return () => window.clearTimeout(handle);
  }, [conversationSearch, refreshConversations]);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    document.title = siteSettings.siteName;
  }, [siteSettings.siteName]);

  useEffect(() => {
    if (!shareNotice) {
      return;
    }

    const handle = window.setTimeout(
      () => setShareNotice(null),
      shareNotice.tone === "success" ? 8000 : 12000
    );

    return () => window.clearTimeout(handle);
  }, [shareNotice]);

  useEffect(() => {
    if (!processStartedAt || processFinishedAt) {
      return;
    }

    const timer = window.setInterval(() => setProcessNow(Date.now()), 1000);

    return () => window.clearInterval(timer);
  }, [processFinishedAt, processStartedAt]);

  const scrollMessagesToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    scrollRef.current?.scrollIntoView({ behavior, block: "end" });
  }, []);

  const scheduleMessagesToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      autoScrollRef.current = true;
      requestAnimationFrame(() => scrollMessagesToBottom(behavior));
    },
    [scrollMessagesToBottom]
  );

  const updateAutoScrollState = useCallback(() => {
    const container = messageScrollRef.current;

    if (!container) {
      autoScrollRef.current = true;
      return;
    }

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    autoScrollRef.current = distanceFromBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
  }, []);

  useEffect(() => {
    if (autoScrollRef.current) {
      scrollMessagesToBottom("auto");
    }
  }, [messages, loading, scrollMessagesToBottom]);

  useEffect(() => {
    function closeFloatingPanels(event: PointerEvent) {
      const target = event.target;
      const targetElement = target instanceof Element ? target : null;

      const insideModelPicker =
        (target instanceof Node && headerControlsRef.current?.contains(target)) ||
        Boolean(targetElement?.closest("[data-model-picker-panel]"));
      const insideConversationMenu = Boolean(
        targetElement?.closest("[data-conversation-menu]")
      );

      if (!insideModelPicker) {
        setModelPickerOpen(false);
      }

      if (!insideConversationMenu) {
        setOpenConversationMenuId(null);
      }
    }

    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      setOpenConversationMenuId(null);
      setModelPickerOpen(false);
    }

    document.addEventListener("pointerdown", closeFloatingPanels);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeFloatingPanels);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  function startNewConversation() {
    const nextConversationKey = createLocalConversationKey();
    autoScrollRef.current = true;
    conversationLoadRequestSeqRef.current += 1;
    activeConversationKeyRef.current = nextConversationKey;
    activeConversationIdRef.current = null;
    setActiveLocalConversationKey(nextConversationKey);
    setActiveConversationId(null);
    setLoadingConversationId(null);
    setMessages([]);
    setPendingAttachments([]);
    setEditingMessage(null);
    setError("");
    setLastContextStats(null);
    setStreamStatus("");
    setToolEvents([]);
    setProcessMessageId(null);
    setProcessStartedAt(null);
    setProcessFinishedAt(null);
    setImageToolEnabled(false);
    setSourceImageMessage(null);
    setTemporaryChatEnabled(defaultTemporaryMode);
    setMemoryWriteDisabledForConversation(false);
    setWebSearchEnabledForMessage(
      webSearchToolAvailable &&
        personalizationSettings.toolPreferences.webSearchDefault
    );
    setMobileSidebarOpen(false);
    setOpenConversationMenuId(null);
    setRenamingConversationId(null);
    setRenamingTitle("");
    setComposerText("");
  }

  async function patchConversation(
    conversationId: string,
    body: { pinned?: boolean; projectId?: string | null; title?: string }
  ) {
    const response = await fetch(`/api/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = (await response.json().catch(() => null)) as
      | { conversation?: ConversationSummary; error?: string }
      | null;

    if (!response.ok || !payload?.conversation) {
      setError(payload?.error || "更新会话失败。");
      return null;
    }

    return payload.conversation;
  }

  async function changeActiveProject(projectId: string) {
    const nextProject = projects.find((project) => project.id === projectId) ?? null;
    setActiveProjectId(projectId);
    const projectDefaultModel = nextProject?.defaultModel
      ? resolveChatModelId(nextProject.defaultModel, chatModels)
      : "";

    if (projectDefaultModel) {
      setModel(projectDefaultModel);
    }

    if (!activeConversationIdRef.current) {
      setStreamStatus(nextProject ? `已选择项目：${nextProject.name}` : "已切回账号默认聊天。");
      return;
    }

    const updated = await patchConversation(activeConversationIdRef.current, {
      projectId: projectId || null
    });

    if (!updated) {
      return;
    }

    setConversations((current) =>
      current.map((conversation) => (conversation.id === updated.id ? updated : conversation))
    );
    setStreamStatus(nextProject ? `当前会话已归入项目：${nextProject.name}` : "当前会话已移出项目。");
  }

  function beginRenameConversation(conversation: ConversationSummary) {
    setRenamingConversationId(conversation.id);
    setRenamingTitle(conversation.title);
    setOpenConversationMenuId(null);
  }

  function cancelRenameConversation() {
    setRenamingConversationId(null);
    setRenamingTitle("");
  }

  async function submitRenameConversation(conversationId: string) {
    const title = renamingTitle.trim();

    if (!title) {
      setError("会话标题不能为空。");
      return;
    }

    const updated = await patchConversation(conversationId, { title });

    if (!updated) {
      return;
    }

    setConversations((current) =>
      current.map((conversation) => (conversation.id === conversationId ? updated : conversation))
    );
    setRenamingConversationId(null);
    setRenamingTitle("");
    setStreamStatus("会话已重命名。");
  }

  async function togglePinConversation(conversation: ConversationSummary) {
    const updated = await patchConversation(conversation.id, { pinned: !conversation.pinned });

    if (!updated) {
      return;
    }

    setOpenConversationMenuId(null);
    await refreshConversations(updated.id);
    setStreamStatus(updated.pinned ? "会话已固定。" : "已取消固定。");
  }

  async function shareConversation(conversation: ConversationSummary) {
    setSharingConversationId(conversation.id);
    setError("");
    setOpenConversationMenuId(null);
    setShareNotice(null);

    try {
      const response = await fetch(`/api/conversations/${conversation.id}/share`, {
        method: "POST"
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; share?: { url?: string } }
        | null;
      const shareUrl = payload?.share?.url;

      if (!response.ok || !shareUrl) {
        const message = payload?.error || "生成分享链接失败。";
        setError(message);
        setShareNotice({
          description: message,
          title: "分享失败",
          tone: "error"
        });
        return;
      }

      try {
        await navigator.clipboard.writeText(shareUrl);
        setStreamStatus("分享链接已复制，可直接发给别人查看。");
        setShareNotice({
          description: "链接已复制到剪贴板，可以直接发给别人查看。",
          title: "分享链接已复制",
          tone: "success",
          url: shareUrl
        });
      } catch {
        const message = "分享链接已生成，但自动复制失败。";
        setError(`${message} ${shareUrl}`);
        setShareNotice({
          description: "可以点“复制链接”再试一次，或直接打开链接。",
          title: message,
          tone: "error",
          url: shareUrl
        });
      }
    } catch (shareError) {
      const message =
        shareError instanceof Error ? `生成分享链接失败：${shareError.message}` : "生成分享链接失败。";
      setError(message);
      setShareNotice({
        description: message,
        title: "分享失败",
        tone: "error"
      });
    } finally {
      setSharingConversationId(null);
    }
  }

  async function copyShareNoticeUrl() {
    if (!shareNotice?.url) {
      return;
    }

    try {
      await navigator.clipboard.writeText(shareNotice.url);
      setStreamStatus("分享链接已复制，可直接发给别人查看。");
      setShareNotice({
        description: "链接已复制到剪贴板，可以直接发给别人查看。",
        title: "分享链接已复制",
        tone: "success",
        url: shareNotice.url
      });
    } catch {
      setShareNotice({
        description: "浏览器阻止了剪贴板写入，可以打开链接后从地址栏复制。",
        title: "复制失败",
        tone: "error",
        url: shareNotice.url
      });
    }
  }

  function requestDeleteConversation(conversation: ConversationSummary) {
    setDeleteConversationTarget(conversation);
    setOpenConversationMenuId(null);
  }

  async function deleteConversation(conversationId: string) {
    setDeletingConversationId(conversationId);
    setError("");
    setOpenConversationMenuId(null);

    try {
      const response = await fetch(`/api/conversations/${conversationId}`, { method: "DELETE" });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error || "删除会话失败。");
        return;
      }

      if (activeConversationId === conversationId) {
        startNewConversation();
      }

      await refreshConversations();
      setStreamStatus("会话已删除。");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? `删除会话失败：${deleteError.message}` : "删除会话失败。");
    } finally {
      setDeletingConversationId(null);
      setDeleteConversationTarget(null);
    }
  }

  function openConversation(conversationId: string) {
    autoScrollRef.current = true;
    setError("");
    setOpenConversationMenuId(null);
    setMobileSidebarOpen(false);

    if (conversationId === activeConversationIdRef.current) {
      return;
    }

    const nextConversation = conversations.find((conversation) => conversation.id === conversationId);
    conversationLoadRequestSeqRef.current += 1;
    activeConversationIdRef.current = conversationId;
    activeConversationKeyRef.current = conversationId;
    setActiveConversationId(conversationId);
    setActiveProjectId(nextConversation?.projectId ?? "");
    setMessages([]);
    setLastContextStats(null);
    setStreamStatus("正在加载会话...");
    setToolEvents([]);
    setProcessMessageId(null);
    setProcessStartedAt(null);
    setProcessFinishedAt(null);
    setImageToolEnabled(false);
    setSourceImageMessage(null);
    setTemporaryChatEnabled(securityModeDefault);
    setMemoryWriteDisabledForConversation(false);
    setWebSearchEnabledForMessage(
      webSearchToolAvailable &&
        personalizationSettings.toolPreferences.webSearchDefault
    );

    if (nextConversation?.model && nextConversation.model !== "image2") {
      setModel(nextConversation.model);
    }

    void loadConversation(conversationId);
  }

  function toggleSidebar() {
    if (window.matchMedia("(min-width: 1024px)").matches) {
      setDesktopSidebarOpen((current) => !current);
      return;
    }

    setMobileSidebarOpen(true);
  }

  async function uploadAttachments(files: FileList | null) {
    if (
      !files?.length ||
      !fileAnalysisAvailable ||
      uploadingAttachments ||
      loading ||
      quotaBlocked ||
      conversationSwitching
    ) {
      return;
    }

    const selectedFiles = Array.from(files);
    const selectedFileNames = selectedFiles.map((file) => file.name).join("、");
    setUploadingAttachments(true);
    setError("");

    const formData = new FormData();

    for (const file of selectedFiles) {
      formData.append("files", file);
    }

    if (temporaryChatEnabled) {
      formData.set("temporary", "1");
    }

    if (activeProjectId) {
      formData.set("projectId", activeProjectId);
    }

    try {
      const response = await fetch("/api/attachments", {
        method: "POST",
        body: formData
      });
      const payload = (await response.json().catch(() => null)) as
        | { attachments?: AttachmentView[]; error?: string }
        | null;

      if (!response.ok || !payload?.attachments) {
        setError(payload?.error || `附件上传失败：${selectedFileNames}`);
        return;
      }

      const uploadedAttachments = payload.attachments;
      setPendingAttachments((current) => [...current, ...uploadedAttachments]);
    } finally {
      setUploadingAttachments(false);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function removePendingAttachment(attachmentId: string) {
    setPendingAttachments((current) =>
      current.filter((attachment) => attachment.id !== attachmentId)
    );
  }

  function isFileDrag(event: DragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  function resetFileDragState() {
    fileDragDepthRef.current = 0;
    setDraggingFiles(false);
  }

  function handleFileDragEnter(event: DragEvent<HTMLElement>) {
    if (!isFileDrag(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (loading || quotaBlocked || uploadingAttachments || conversationSwitching) {
      return;
    }

    fileDragDepthRef.current += 1;
    setDraggingFiles(true);
  }

  function handleFileDragOver(event: DragEvent<HTMLElement>) {
    if (!isFileDrag(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect =
      loading || quotaBlocked || uploadingAttachments || conversationSwitching ? "none" : "copy";
  }

  function handleFileDragLeave(event: DragEvent<HTMLElement>) {
    if (!isFileDrag(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);

    if (fileDragDepthRef.current === 0) {
      setDraggingFiles(false);
    }
  }

  function handleFileDrop(event: DragEvent<HTMLElement>) {
    if (!isFileDrag(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    resetFileDragState();

    if (loading) {
      setError("生成中不能上传附件。");
      return;
    }

    if (quotaBlocked) {
      setError("余额不足，请联系管理员。");
      return;
    }

    if (uploadingAttachments) {
      setError("附件正在上传，请稍后再试。");
      return;
    }

    if (conversationSwitching) {
      setError("会话正在加载，请稍后再试。");
      return;
    }

    void uploadAttachments(event.dataTransfer.files);
  }

  function stopGeneration() {
    const now = Date.now();
    const conversationKey = activeConversationKeyRef.current;
    const controller = abortControllersRef.current.get(conversationKey);
    const inFlightChat = getInFlightChat(conversationKey);
    const nextToolEvents = (inFlightChat?.toolEvents ?? toolEvents).map((event) =>
      event.status === "running"
        ? { ...event, detail: "已停止", finishedAt: now, status: "skipped" as const }
        : event
    );

    controller?.abort();
    abortControllersRef.current.delete(conversationKey);
    markGenerationFinished(conversationKey);

    if (inFlightChat) {
      storeInFlightChat(conversationKey, {
        ...inFlightChat,
        assistantMessage: { ...inFlightChat.assistantMessage, pending: false },
        processFinishedAt: now,
        streamStatus: "已停止。",
        toolEvents: nextToolEvents
      });
    }

    setProcessFinishedAt(now);
    setStreamStatus("已停止。");
    setToolEvents(nextToolEvents);
    setMessages((current) =>
      current.map((message) => (message.pending ? { ...message, pending: false } : message))
    );
  }

  async function sendChat(
    prompt: string,
    attachments: AttachmentView[],
    options: {
      disableMemoryWrite?: boolean;
      imageToolRequested?: boolean;
      reuseUserMessage?: MessageView;
      sourceImageMessage?: MessageView | null;
      temporary?: boolean;
      useWebSearch?: boolean;
    } = {}
  ) {
    const reuseUserMessage = options.reuseUserMessage;
    const reuseUserMessageId = reuseUserMessage?.id;
    const sourceImageMessageId = options.sourceImageMessage?.id;
    const requestTemporary = options.temporary ?? temporaryChatEnabled;
    const requestDisableMemoryWrite =
      options.disableMemoryWrite ?? (memoryWriteDisabledForConversation || requestTemporary);
    const temporaryMessages = requestTemporary
      ? messages
          .filter(
            (message) =>
              !message.pending &&
              !message.imageUrl &&
              (message.role === "USER" || message.role === "ASSISTANT")
          )
          .slice(-20)
          .map((message) => ({
            content: message.content,
            role: message.role
          }))
      : [];
    const useWebSearch = Boolean(options.useWebSearch);
    const localUser = reuseUserMessage ?? emptyMessage("USER", prompt, "CHAT", attachments);
    const localAssistant = {
      ...emptyMessage("ASSISTANT", "", "CHAT"),
      model
    };
    const controller = new AbortController();
    const processStart = Date.now();
    const startingConversationId = reuseUserMessage?.conversationId ?? activeConversationIdRef.current;
    // Rebound when the server returns the persisted conversation id for a new local chat.
    let conversationKey = startingConversationId ?? activeConversationKeyRef.current;
    const initialStreamStatus = useWebSearch ? "正在联网搜索..." : "正在自动选择工具...";
    const initialToolEvents = [
      createToolEvent(
        {
          detail: useWebSearch
            ? "已强制开启联网搜索，正在整理来源"
            : attachments.length
              ? "正在判断是否需要读取附件、生图、搜索或直接对话"
              : "正在判断是否需要生图、搜索或直接对话",
          id: "router",
          label: "自动路由",
          status: "running",
          type: "router"
        },
        processStart
      )
    ];

    abortControllersRef.current.set(conversationKey, controller);
    markGenerationRunning(conversationKey);
    storeInFlightChat(conversationKey, {
      assistantMessage: localAssistant,
      contextStats: null,
      conversationId: startingConversationId,
      processFinishedAt: null,
      processStartedAt: processStart,
      streamStatus: initialStreamStatus,
      toolEvents: initialToolEvents
    });
    if (isViewingConversationKey(conversationKey)) {
      autoScrollRef.current = true;
      setProcessMessageId(localAssistant.id);
      setProcessStartedAt(processStart);
      setProcessFinishedAt(null);
      setProcessNow(processStart);

      setMessages((current) => {
        if (!reuseUserMessageId) {
          return [...current, localUser, localAssistant];
        }

        const userIndex = current.findIndex((message) => message.id === reuseUserMessageId);
        const base = userIndex >= 0 ? current.slice(0, userIndex + 1) : current;

        return [...base, localAssistant];
      });
      scheduleMessagesToBottom();
      setToolEvents(initialToolEvents);
      setStreamStatus(initialStreamStatus);
    }

    const finishProcess = () => {
      const now = Date.now();
      const inFlightChat = getInFlightChat(conversationKey);
      const nextToolEvents = (inFlightChat?.toolEvents ?? []).map((event) =>
        event.status === "running" ? { ...event, finishedAt: now, status: "skipped" as const } : event
      );

      if (inFlightChat?.assistantMessage.id === localAssistant.id) {
        storeInFlightChat(conversationKey, {
          ...inFlightChat,
          processFinishedAt: now,
          toolEvents: nextToolEvents
        });
      }

      markGenerationFinished(conversationKey);

      if (isViewingConversationKey(conversationKey)) {
        setProcessFinishedAt(now);
        setToolEvents((current) =>
          current.map((event) =>
            event.status === "running" ? { ...event, finishedAt: now, status: "skipped" } : event
          )
        );
      }
    };

    let response: Response;

    try {
      const promptClock = formatPromptClock();

      response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: requestTemporary ? undefined : startingConversationId,
          projectId: activeProjectId || null,
          model,
          reasoningEffort,
          content: prompt,
          disableMemoryWrite: requestDisableMemoryWrite,
          imageToolRequested: Boolean(options.imageToolRequested),
          reuseUserMessageId,
          sourceImageMessageId,
          temporary: requestTemporary,
          temporaryMessages,
          useWebSearch,
          webSearchProvider,
          clientDate: promptClock.date,
          clientTime: promptClock.time,
          clientTimeZone: promptClock.timeZone,
          attachmentIds: attachments.map((attachment) => attachment.id)
        }),
        signal: controller.signal
      });
    } catch (fetchError) {
      finishProcess();

      if (controller.signal.aborted) {
        abortControllersRef.current.delete(conversationKey);
        deleteInFlightChat(conversationKey);
        if (isViewingConversationKey(conversationKey)) {
          setStreamStatus("已停止。");
        }
        return;
      }

      const message =
        fetchError instanceof Error ? `连接上游失败：${fetchError.message}` : "连接上游失败。";
      abortControllersRef.current.delete(conversationKey);
      deleteInFlightChat(conversationKey);
      if (isViewingConversationKey(conversationKey)) {
        setMessages((current) =>
          current.map((item) =>
            item.id === localAssistant.id ? { ...item, content: message, pending: false } : item
          )
        );
        setError(message);
        setStreamStatus("连接失败。");
      }
      return;
    }

    if (!response.ok || !response.body) {
      finishProcess();
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; usage?: UsageSummary }
        | null;

      if (payload?.usage) {
        setUsage(payload.usage);
      }

      abortControllersRef.current.delete(conversationKey);
      deleteInFlightChat(conversationKey);
      if (isViewingConversationKey(conversationKey)) {
        setMessages((current) =>
          current.map((message) =>
            message.id === localAssistant.id
              ? { ...message, content: payload?.error || "发送失败。", pending: false }
              : message
          )
        );
        setError(payload?.error || "发送失败。");
        setStreamStatus("发送失败。");
      }
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let receivedDelta = false;
    let pendingContentDelta = "";
    let pendingReasoningDelta = "";
    let streamStatusStarted = false;
    let streamTerminated = false;
    let streamFlushTimer: ReturnType<typeof setTimeout> | null = null;
    let routedToImage = false;
    let persistedConversationId = startingConversationId ?? null;

    const getCurrentInFlightChat = () =>
      getInFlightChat(conversationKey)?.assistantMessage.id === localAssistant.id
        ? getInFlightChat(conversationKey)
        : null;
    const isViewingInFlightChat = () => isViewingConversationKey(conversationKey);
    const updateInFlightChat = (patch: Partial<InFlightChatGeneration>) => {
      const current = getCurrentInFlightChat();

      if (!current) {
        return null;
      }

      const next = { ...current, ...patch };
      storeInFlightChat(conversationKey, next);
      return next;
    };
    const setChatStreamStatus = (status: string) => {
      updateInFlightChat({ streamStatus: status });

      if (isViewingInFlightChat()) {
        setStreamStatus(status);
      }
    };
    const setChatProcessFinishedAt = (finishedAt: number | null) => {
      updateInFlightChat({ processFinishedAt: finishedAt });

      if (isViewingInFlightChat()) {
        setProcessFinishedAt(finishedAt);
      }
    };
    const setChatContextStats = (contextStats: ContextStats | null) => {
      updateInFlightChat({ contextStats });

      if (isViewingInFlightChat()) {
        setLastContextStats(contextStats);
      }
    };
    const setChatToolEvents = (updater: (current: ToolEventView[]) => ToolEventView[]) => {
      const nextEvents = updater(getCurrentInFlightChat()?.toolEvents ?? []);
      updateInFlightChat({ toolEvents: nextEvents });

      if (isViewingInFlightChat()) {
        setToolEvents(nextEvents);
        setProcessNow(Date.now());
      }

      return nextEvents;
    };
    const updateChatAssistantMessage = (updater: (message: MessageView) => MessageView) => {
      const current = getCurrentInFlightChat();

      if (!current) {
        return;
      }

      const nextAssistantMessage = updater(current.assistantMessage);
      updateInFlightChat({ assistantMessage: nextAssistantMessage });

      if (!isViewingInFlightChat()) {
        return;
      }

      setMessages((currentMessages) => {
        const existingIndex = currentMessages.findIndex(
          (message) => message.id === localAssistant.id
        );

        if (existingIndex < 0) {
          return [...currentMessages, nextAssistantMessage];
        }

        return currentMessages.map((message) =>
          message.id === localAssistant.id ? nextAssistantMessage : message
        );
      });
    };
    const clearCurrentInFlightChat = () => {
      if (getCurrentInFlightChat()) {
        deleteInFlightChat(conversationKey);
      }
    };

    setChatStreamStatus(GENERATION_THINKING_STATUS);

    const clearStreamFlushTimer = () => {
      if (streamFlushTimer) {
        clearTimeout(streamFlushTimer);
        streamFlushTimer = null;
      }
    };
    const flushPendingOutput = () => {
      if (!pendingContentDelta && !pendingReasoningDelta) {
        clearStreamFlushTimer();
        return;
      }

      const contentDelta = pendingContentDelta;
      const reasoningDelta = pendingReasoningDelta;
      pendingContentDelta = "";
      pendingReasoningDelta = "";
      clearStreamFlushTimer();

      updateChatAssistantMessage((message) => ({
        ...message,
        content: contentDelta ? `${message.content}${contentDelta}` : message.content,
        reasoningContent: reasoningDelta
          ? `${message.reasoningContent || ""}${reasoningDelta}`
          : message.reasoningContent
      }));
    };
    const scheduleStreamFlush = () => {
      if (!streamFlushTimer) {
        streamFlushTimer = setTimeout(flushPendingOutput, STREAM_RENDER_INTERVAL_MS);
      }
    };
    const upsertToolEvent = (toolEvent: ToolEventUpdate) => {
      const now = Date.now();
      setChatToolEvents((current) => mergeToolEvent(current, toolEvent, now));
    };

    const handleEvent = (event: SseEvent) => {
      if (event.event === "meta") {
        const nextConversationId =
          typeof event.data.conversationId === "string" ? event.data.conversationId : "";
        const temporaryMeta = event.data.temporary === true;

        if (!nextConversationId && !temporaryMeta) {
          return;
        }

        if (!temporaryMeta) {
          conversationKey = resolveInFlightConversationKey(conversationKey, nextConversationId);
          persistedConversationId = nextConversationId;
        }

        const assistantDraft = event.data.assistantMessage as MessageView | undefined;
        const routeIsImage = assistantDraft?.mode === "IMAGE" || Boolean(assistantDraft?.imageUrl);
        routedToImage = routedToImage || routeIsImage;

        if (assistantDraft?.id) {
          const currentInFlight = getInFlightChat(conversationKey);
          const previousAssistantId = localAssistant.id;
          const currentAssistant = currentInFlight?.assistantMessage ?? localAssistant;
          const nextAssistant = {
            ...assistantDraft,
            content: currentAssistant.content || assistantDraft.content,
            reasoningContent: currentAssistant.reasoningContent || assistantDraft.reasoningContent,
            pending: true
          };

          localAssistant.id = assistantDraft.id;
          localAssistant.conversationId = temporaryMeta ? localAssistant.conversationId : nextConversationId;

          if (currentInFlight) {
            storeInFlightChat(conversationKey, {
              ...currentInFlight,
              assistantMessage: nextAssistant,
              conversationId: temporaryMeta ? currentInFlight.conversationId : nextConversationId
            });
          }

          if (isViewingInFlightChat()) {
            setProcessMessageId(assistantDraft.id);
            setMessages((current) =>
              current.map((message) =>
                message.id === previousAssistantId || message.id === assistantDraft.id
                  ? nextAssistant
                  : message
              )
            );
          }
        } else {
          updateChatAssistantMessage((message) => ({
            ...message,
            conversationId: temporaryMeta ? message.conversationId : nextConversationId
          }));
        }

        if (!temporaryMeta) {
          void refreshConversations();
        }

        if (event.data.context) {
          const contextStats = event.data.context as ContextStats;
          setChatContextStats(contextStats);
        }

        if (event.data.userMessage && isViewingInFlightChat()) {
          const userMessage = event.data.userMessage as MessageView;
          setMessages((current) =>
            current.map((message) => (message.id === localUser.id ? userMessage : message))
          );
        }

        if (!routeIsImage) {
          upsertToolEvent({
            detail: GENERATION_THINKING_DETAIL,
            id: "generation",
            label: GENERATION_THINKING_LABEL,
            status: "running",
            type: "generation"
          });
        }
      }

      if (event.event === "tool") {
        const toolEvent = event.data as Partial<ToolEventView>;

        if (toolEvent.id && toolEvent.label && toolEvent.type && toolEvent.status) {
          if (toolEvent.id === "image" || toolEvent.type === "image") {
            routedToImage = true;
          }

          upsertToolEvent({
            detail: typeof toolEvent.detail === "string" ? toolEvent.detail : undefined,
            finishedAt: typeof toolEvent.finishedAt === "number" ? toolEvent.finishedAt : undefined,
            id: toolEvent.id,
            label: toolEvent.label,
            startedAt: typeof toolEvent.startedAt === "number" ? toolEvent.startedAt : undefined,
            status: toolEvent.status,
            type: toolEvent.type
          });

          if (toolEvent.status === "running") {
            setChatStreamStatus(
              toolEvent.detail ||
                (toolEvent.id === "generation"
                  ? GENERATION_THINKING_STATUS
                  : `${toolEvent.label}中...`)
            );
          } else if (toolEvent.status === "done") {
            setChatStreamStatus(toolEvent.detail || `${toolEvent.label}完成。`);
          }
        }
      }

      if (event.event === "delta") {
        const delta = String(event.data.delta ?? "");

        if (delta) {
          receivedDelta = true;
          pendingContentDelta += delta;
          scheduleStreamFlush();

          if (!streamStatusStarted) {
            streamStatusStarted = true;
            upsertToolEvent({
              detail: GENERATION_STREAMING_DETAIL,
              id: "generation",
              label: GENERATION_THINKING_LABEL,
              status: "running",
              type: "generation"
            });
            setChatStreamStatus(GENERATION_STREAMING_STATUS);
          }
        }
      }

      if (event.event === "reasoning") {
        const delta = String(event.data.delta ?? "");

        if (delta) {
          pendingReasoningDelta += delta;
          scheduleStreamFlush();
        }
      }

      if (event.event === "done") {
        const now = Date.now();
        streamTerminated = true;
        clearStreamFlushTimer();
        pendingContentDelta = "";
        pendingReasoningDelta = "";
        const assistantMessage = {
          ...(event.data.assistantMessage as MessageView),
          pending: false
        };
        const resultIsImage =
          assistantMessage.mode === "IMAGE" || Boolean(assistantMessage.imageUrl);
        updateInFlightChat({ assistantMessage });

        if (isViewingInFlightChat()) {
          setMessages((current) => {
            const localAssistantIndex = current.findIndex(
              (message) => message.id === localAssistant.id
            );

            if (localAssistantIndex >= 0) {
              return current.map((message) =>
                message.id === localAssistant.id ? assistantMessage : message
              );
            }

            if (current.some((message) => message.id === assistantMessage.id)) {
              return current.map((message) =>
                message.id === assistantMessage.id ? assistantMessage : message
              );
            }

            return [...current, assistantMessage];
          });
        }

        if (event.data.usage) {
          setUsage(event.data.usage as UsageSummary);
        }

        setChatToolEvents((current) =>
          mergeToolEvent(
            mergeToolEvent(current, {
              detail: resultIsImage
                ? "图片已生成"
                : receivedDelta
                  ? "回答已生成"
                  : "上游已完成，但没有返回可见文本",
              id: resultIsImage ? "image" : "generation",
              label: resultIsImage ? "image2" : "模型生成",
              status: "done",
              type: resultIsImage ? "image" : "generation"
            }, now),
            {
              detail: "已更新余额和费用",
              id: "usage",
              label: "用量统计",
              status: "done",
              type: "usage"
            },
            now
          )
        );
        setChatProcessFinishedAt(now);
        setChatStreamStatus(
          resultIsImage
            ? "生图完成。"
            : receivedDelta
              ? "已完成。"
              : "上游已完成，但没有返回可见文本。"
        );
        markGenerationFinished(conversationKey);
        abortControllersRef.current.delete(conversationKey);
        clearCurrentInFlightChat();
      }

      if (event.event === "error") {
        const now = Date.now();
        streamTerminated = true;
        clearStreamFlushTimer();
        pendingContentDelta = "";
        pendingReasoningDelta = "";
        const message = String(event.data.error ?? "上游调用失败。");
        const assistantMessage = event.data.assistantMessage as MessageView | null | undefined;
        const resultIsImage = assistantMessage?.mode === "IMAGE" || Boolean(assistantMessage?.imageUrl);

        if (assistantMessage?.id) {
          const nextAssistantMessage = { ...assistantMessage, pending: false };
          updateInFlightChat({ assistantMessage: nextAssistantMessage });

          if (isViewingInFlightChat()) {
            setMessages((current) =>
              current.map((item) =>
                item.id === localAssistant.id || item.id === assistantMessage.id
                  ? nextAssistantMessage
                  : item
              )
            );
          }
        } else {
          updateChatAssistantMessage((item) => ({ ...item, content: message, pending: false }));
        }
        if (isViewingInFlightChat() && !assistantMessage?.id) {
          setError(message);
        }
        setChatToolEvents((current) =>
          mergeToolEvent(current, {
            detail: message,
            id: resultIsImage ? "image" : "generation",
            label: resultIsImage ? "image2" : "模型生成",
            status: "error",
            type: resultIsImage ? "image" : "generation"
          }, now)
        );
        setChatProcessFinishedAt(now);
        setChatStreamStatus(resultIsImage ? "生图失败。" : "上游调用失败。");
        markGenerationFinished(conversationKey);
        abortControllersRef.current.delete(conversationKey);
        clearCurrentInFlightChat();
      }
    };
    const wait = (delayMs: number) =>
      new Promise((resolve) => window.setTimeout(resolve, delayMs));
    const syncPersistedImageResult = async () => {
      const targetConversationId =
        persistedConversationId ?? (conversationKey.startsWith("local-") ? null : conversationKey);

      if (!targetConversationId) {
        return false;
      }

      for (const delayMs of [2000, 4000, 8000, 12000, 16000, 20000, 25000, 30000]) {
        await wait(delayMs);

        if (controller.signal.aborted) {
          return false;
        }

        const response = await fetch(`/api/conversations/${targetConversationId}?context=0`).catch(
          () => null
        );

        if (!response?.ok) {
          continue;
        }

        const payload = (await response.json().catch(() => null)) as
          | { conversation?: ConversationSummary & { messages: MessageView[] }; context?: ContextStats }
          | null;
        const persistedMessages = payload?.conversation?.messages;

        if (!payload?.conversation || !persistedMessages) {
          continue;
        }

        const processMessage = latestMessageProcess(persistedMessages);

        if (isViewingConversationKey(targetConversationId)) {
          setMessages(persistedMessages);
          setLastContextStats(payload.context ?? null);

          if (processMessage) {
            setStreamStatus(messageProcessStatus(processMessage));
            setToolEvents(processMessage.toolEvents ?? []);
            setProcessMessageId(processMessage.id);
            setProcessStartedAt(processMessage.processStartedAt ?? null);
            setProcessFinishedAt(processMessage.processFinishedAt ?? null);
            setProcessNow(processMessage.processFinishedAt ?? Date.now());
          } else {
            setProcessMessageId(null);
          }
        }

        if (processMessage?.generationStatus && processMessage.generationStatus !== "running") {
          await refreshConversations();
          void refreshMe();
          return true;
        }
      }

      return false;
    };

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() ?? "";

        for (const block of blocks) {
          const event = parseSseBlock(block);

          if (!event) {
            continue;
          }

          handleEvent(event);
        }
      }

      const tailEvent = parseSseBlock(buffer);

      if (tailEvent) {
        handleEvent(tailEvent);
      }

      if (!streamTerminated && !controller.signal.aborted) {
        const now = Date.now();
        flushPendingOutput();
        updateChatAssistantMessage((item) => ({ ...item, pending: false }));
        setChatToolEvents((current) =>
          mergeToolEvent(current, {
            detail: receivedDelta
              ? "连接提前结束，已保留收到的内容"
              : "连接提前结束，未收到完成标记",
            id: "generation",
            label: "模型生成",
            status: "error",
            type: "generation"
          }, now)
        );
        setChatProcessFinishedAt(now);
        setChatStreamStatus(
          receivedDelta ? "连接提前结束，已保留部分内容。" : "连接提前结束。"
        );
        markGenerationFinished(conversationKey);
        abortControllersRef.current.delete(conversationKey);
        clearCurrentInFlightChat();
        await refreshConversations();
        return;
      }
    } catch (streamError) {
      const now = Date.now();

      if (controller.signal.aborted) {
        flushPendingOutput();
        setChatProcessFinishedAt(now);
        setChatStreamStatus("已停止。");
        setChatToolEvents((current) =>
          current.map((event) =>
            event.status === "running"
              ? { ...event, detail: "已停止", finishedAt: now, status: "skipped" }
              : event
          )
        );
        updateChatAssistantMessage((item) => ({ ...item, pending: false }));
        markGenerationFinished(conversationKey);
        abortControllersRef.current.delete(conversationKey);
        clearCurrentInFlightChat();
        return;
      }

      clearStreamFlushTimer();
      pendingContentDelta = "";
      pendingReasoningDelta = "";
      const interruptedImage =
        routedToImage ||
        getCurrentInFlightChat()?.assistantMessage.mode === "IMAGE" ||
        getCurrentInFlightChat()?.assistantMessage.model === "image2";
      const message = interruptedImage
        ? "连接中断，后台生图仍在进行，正在同步结果..."
        : streamError instanceof Error
          ? `流式连接中断：${streamError.message}`
          : "流式连接中断。";

      if (interruptedImage) {
        updateChatAssistantMessage((item) => ({
          ...item,
          content: item.content || "生成中...",
          pending: true
        }));
        setChatToolEvents((current) =>
          mergeToolEvent(current, {
            detail: message,
            id: "image",
            label: "image2",
            status: "running",
            type: "image"
          }, now)
        );
        setChatStreamStatus(message);
        const synced = await syncPersistedImageResult();

        if (!synced) {
          const fallbackMessage = "连接中断；图片可能仍在后台生成，稍后重新打开会话可查看结果。";
          updateChatAssistantMessage((item) => ({
            ...item,
            content: fallbackMessage,
            pending: false
          }));
          setError(fallbackMessage);
          setChatToolEvents((current) =>
            mergeToolEvent(current, {
              detail: fallbackMessage,
              id: "image",
              label: "image2",
              status: "error",
              type: "image"
            }, Date.now())
          );
          setChatStreamStatus("生图连接中断。");
        }

        markGenerationFinished(conversationKey);
        abortControllersRef.current.delete(conversationKey);
        clearCurrentInFlightChat();
        return;
      }

      updateChatAssistantMessage((item) => ({ ...item, content: message, pending: false }));
      if (isViewingInFlightChat()) {
        setError(message);
      }
      setChatToolEvents((current) =>
        mergeToolEvent(current, {
          detail: message,
          id: "generation",
          label: "模型生成",
          status: "error",
          type: "generation"
        }, now)
      );
      setChatProcessFinishedAt(now);
      setChatStreamStatus("流式连接中断。");
      markGenerationFinished(conversationKey);
      abortControllersRef.current.delete(conversationKey);
      clearCurrentInFlightChat();
    }

    flushPendingOutput();

    if (abortControllersRef.current.get(conversationKey) === controller) {
      abortControllersRef.current.delete(conversationKey);
    }
    markGenerationFinished(conversationKey);

    await refreshConversations();
  }

  async function sendImage(
    prompt: string,
    attachments: AttachmentView[],
    options: {
      reuseUserMessage?: MessageView;
      sourceImageMessage?: MessageView | null;
    } = {}
  ) {
    const reuseUserMessage = options.reuseUserMessage;
    const reuseUserMessageId = reuseUserMessage?.id;
    const sourceImageMessageId = options.sourceImageMessage?.id;
    let startingConversationId = reuseUserMessage?.conversationId ?? activeConversationIdRef.current;

    if (!startingConversationId && !reuseUserMessage) {
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "IMAGE",
          model: "image2",
          projectId: activeProjectId || null,
          title: prompt.trim().slice(0, 48) || "New image"
        })
      }).catch(() => null);
      const payload = response?.ok
        ? ((await response.json().catch(() => null)) as
            | { conversation?: ConversationSummary }
            | null)
        : null;

      if (payload?.conversation?.id) {
        startingConversationId = payload.conversation.id;
        activeConversationIdRef.current = payload.conversation.id;
        activeConversationKeyRef.current = payload.conversation.id;
        setActiveConversationId(payload.conversation.id);
        setConversations((current) => [
          payload.conversation as ConversationSummary,
          ...current.filter((conversation) => conversation.id !== payload.conversation?.id)
        ]);
      }
    }

    const localUser = reuseUserMessage
      ? { ...reuseUserMessage, attachments, content: prompt, mode: "IMAGE" as const, model: "image2" }
      : {
          ...emptyMessage("USER", prompt, "IMAGE", attachments),
          conversationId: startingConversationId ?? "local",
          model: "image2"
        };
    const localAssistant = {
      ...emptyMessage("ASSISTANT", "生成中...", "IMAGE"),
      conversationId: startingConversationId ?? "local",
      model: "image2"
    };
    const controller = new AbortController();
    const processStart = Date.now();
    let conversationKey = startingConversationId ?? activeConversationKeyRef.current;
    const initialToolEvents = [
      createToolEvent(
        {
          detail:
            sourceImageMessageId || attachments.some((attachment) => attachment.kind === "IMAGE")
              ? "正在基于图片生成或编辑"
              : "正在根据文字生成图片",
          id: "image",
          label: "image2",
          status: "running",
          type: "image"
        },
        processStart
      )
    ];

    abortControllersRef.current.set(conversationKey, controller);
    markGenerationRunning(conversationKey);
    storeInFlightChat(conversationKey, {
      assistantMessage: localAssistant,
      contextStats: null,
      conversationId: startingConversationId,
      processFinishedAt: null,
      processStartedAt: processStart,
      streamStatus: "正在使用 image2 生成图片...",
      toolEvents: initialToolEvents
    });

    if (isViewingConversationKey(conversationKey)) {
      autoScrollRef.current = true;
      setProcessMessageId(localAssistant.id);
      setProcessStartedAt(processStart);
      setProcessFinishedAt(null);
      setProcessNow(processStart);
      setToolEvents(initialToolEvents);
      setStreamStatus("正在使用 image2 生成图片...");
      setMessages((current) => {
        if (!reuseUserMessageId) {
          return [...current, localUser, localAssistant];
        }

        const userIndex = current.findIndex((message) => message.id === reuseUserMessageId);
        const base = userIndex >= 0 ? current.slice(0, userIndex + 1) : current;

        return [...base, localAssistant];
      });
      scheduleMessagesToBottom();
    }

    const finish = (status: "done" | "error" | "skipped", detail: string) => {
      const now = Date.now();
      const nextToolEvents = mergeToolEvent(initialToolEvents, {
        detail,
        finishedAt: now,
        id: "image",
        label: "image2",
        status,
        type: "image"
      }, now);

      markGenerationFinished(conversationKey);
      abortControllersRef.current.delete(conversationKey);
      deleteInFlightChat(conversationKey);

      if (isViewingConversationKey(conversationKey)) {
        setToolEvents(nextToolEvents);
        setProcessFinishedAt(now);
        setProcessNow(now);
        setStreamStatus(
          status === "done" ? "生图完成。" : status === "skipped" ? "已停止。" : "生图失败。"
        );
      }

      return { finishedAt: now, toolEvents: nextToolEvents };
    };
    const cleanupImageInFlight = () => {
      markGenerationFinished(conversationKey);
      abortControllersRef.current.delete(conversationKey);
      deleteInFlightChat(conversationKey);
    };
    const applyPersistedImagePayload = async (payload: {
      assistantMessage?: MessageView;
      conversationId?: string;
      error?: string;
      usage?: UsageSummary;
      userMessage?: MessageView;
    }) => {
      if (!payload.assistantMessage || !payload.conversationId) {
        return false;
      }

      conversationKey = resolveInFlightConversationKey(conversationKey, payload.conversationId);
      const assistantMessage = { ...payload.assistantMessage, pending: false };
      const userMessage = payload.userMessage;

      if (isViewingConversationKey(conversationKey)) {
        setProcessMessageId(assistantMessage.id);
        setMessages((current) =>
          current.map((item) => {
            if (item.id === localAssistant.id || item.id === assistantMessage.id) {
              return assistantMessage;
            }

            if (userMessage && item.id === localUser.id) {
              return userMessage;
            }

            return item;
          })
        );
      }

      if (payload.usage) {
        setUsage(payload.usage);
      }

      const imageStatus =
        assistantMessage.generationStatus === "error"
          ? "error"
          : assistantMessage.generationStatus === "stopped"
            ? "skipped"
            : "done";

      finish(
        imageStatus,
        imageStatus === "done" ? "图片已生成" : payload.error || assistantMessage.content || "生图失败。"
      );
      await refreshConversations();
      return true;
    };
    const waitForImageRecovery = async (targetConversationId?: string | null) => {
      const resolvedConversationId =
        targetConversationId ?? (conversationKey.startsWith("local-") ? null : conversationKey);

      if (!resolvedConversationId) {
        return false;
      }

      const wait = (delayMs: number) =>
        new Promise((resolve) => window.setTimeout(resolve, delayMs));

      for (const delayMs of [1200, 2400, 4000, 7000, 11000, 16000, 22000, 30000]) {
        await wait(delayMs);

        if (controller.signal.aborted) {
          return false;
        }

        const response = await fetch(`/api/conversations/${resolvedConversationId}?context=0`).catch(
          () => null
        );

        if (!response?.ok) {
          continue;
        }

        const payload = (await response.json().catch(() => null)) as
          | { conversation?: ConversationSummary & { messages: MessageView[] }; context?: ContextStats }
          | null;
        const persistedMessages = payload?.conversation?.messages;

        if (!payload?.conversation || !persistedMessages) {
          continue;
        }

        conversationKey = resolveInFlightConversationKey(
          conversationKey,
          payload.conversation.id
        );

        const recoveredImageMessage = [...persistedMessages].reverse().find(
          (message) =>
            message.role === "ASSISTANT" &&
            Boolean(message.processStartedAt) &&
            (message.mode === "IMAGE" || message.model === "image2" || Boolean(message.imageUrl)) &&
            (message.processStartedAt ?? 0) >= processStart - 15_000
        );
        const processMessage = recoveredImageMessage ?? latestMessageProcess(persistedMessages);

        if (isViewingConversationKey(payload.conversation.id)) {
          setMessages(persistedMessages);
          setLastContextStats(payload.context ?? null);

          if (processMessage) {
            setStreamStatus(messageProcessStatus(processMessage));
            setToolEvents(processMessage.toolEvents ?? []);
            setProcessMessageId(processMessage.id);
            setProcessStartedAt(processMessage.processStartedAt ?? null);
            setProcessFinishedAt(processMessage.processFinishedAt ?? null);
            setProcessNow(processMessage.processFinishedAt ?? Date.now());
          }
        }

        if (
          recoveredImageMessage?.generationStatus &&
          recoveredImageMessage.generationStatus !== "running"
        ) {
          cleanupImageInFlight();
          await refreshConversations();
          void refreshMe();
          return true;
        }
      }

      return false;
    };

    try {
      const response = await fetch("/api/images", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          attachmentIds: attachments.map((attachment) => attachment.id),
          conversationId: startingConversationId,
          model: "image2",
          projectId: activeProjectId || null,
          prompt,
          reuseUserMessageId,
          sourceImageMessageId
        }),
        signal: controller.signal
      });
      const payload = (await response.json().catch(() => null)) as
        | {
          assistantMessage?: MessageView;
          conversationId?: string;
          error?: string;
          usage?: UsageSummary;
          userMessage?: MessageView;
          }
        | null;

      if (await applyPersistedImagePayload(payload ?? {})) {
        return;
      }

      if (!response.ok || !payload?.assistantMessage || !payload.conversationId) {
        const recovered = await waitForImageRecovery(payload?.conversationId ?? startingConversationId);

        if (recovered) {
          return;
        }

        const message = payload?.error || "生图失败。";
        finish("error", message);

        if (isViewingConversationKey(conversationKey)) {
          setMessages((current) =>
            current.map((item) =>
              item.id === localAssistant.id
                ? { ...localAssistant, content: message, pending: false }
                : item.id === localUser.id && payload?.userMessage
                  ? payload.userMessage
                  : item
            )
          );
        }
        return;
      }

    } catch (error) {
      if (controller.signal.aborted) {
        finish("skipped", "已停止");
        return;
      }

      const message = error instanceof Error ? `生图失败：${error.message}` : "生图失败。";
      const recovered = await waitForImageRecovery(startingConversationId);

      if (recovered) {
        return;
      }

      finish("error", message);

      if (isViewingConversationKey(conversationKey)) {
        setMessages((current) =>
          current.map((item) =>
            item.id === localAssistant.id ? { ...localAssistant, content: message, pending: false } : item
          )
        );
      }
    } finally {
      void refreshMe();
    }
  }

  function findPreviousUserMessage(messageId: string) {
    const index = messages.findIndex((message) => message.id === messageId);

    if (index <= 0) {
      return null;
    }

    for (let current = index - 1; current >= 0; current -= 1) {
      if (messages[current]?.role === "USER") {
        return messages[current];
      }
    }

    return null;
  }

  async function copyMessage(message: MessageView) {
    await navigator.clipboard.writeText(message.content);
    setStreamStatus("已复制。");
  }

  async function deleteMessage(message: MessageView): Promise<boolean> {
    const conversationKey = activeConversationKeyRef.current;

    if (isLocalMessage(message)) {
      setMessages((current) => current.filter((item) => item.id !== message.id));
      setError("");
      setStreamStatus("消息已删除。");
      return true;
    }

    const response = await fetch(`/api/messages/${message.id}`, {
      method: "DELETE"
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (response.status === 404) {
        if (isViewingConversationKey(conversationKey)) {
          setMessages((current) => current.filter((item) => item.id !== message.id));
          setError("");
          setStreamStatus("消息已从当前会话移除。");
        }
        return true;
      }

      if (isViewingConversationKey(conversationKey)) {
        setError(payload?.error || "删除消息失败。");
      }
      return false;
    }

    if (isViewingConversationKey(conversationKey)) {
      setMessages((current) => current.filter((item) => item.id !== message.id));
      setError("");
      setStreamStatus("消息已删除。");
    }
    await refreshConversations(activeConversationId ?? undefined).catch(() => undefined);
    return true;
  }

  function requestDeleteMessage(message: MessageView) {
    setDeleteMessageTarget(message);
  }

  async function confirmDeleteMessage() {
    if (!deleteMessageTarget) {
      return;
    }

    const target = deleteMessageTarget;
    setDeletingMessageId(target.id);

    try {
      const deleted = await deleteMessage(target);
      if (deleted) {
        setDeleteMessageTarget(null);
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? `删除消息失败：${deleteError.message}` : "删除消息失败。");
    } finally {
      setDeletingMessageId(null);
    }
  }

  function startEditMessage(message: MessageView) {
    setEditingMessage(message);
    setComposerText(message.content, true);
    setPendingAttachments([]);
    setSourceImageMessage(null);
    setError("");
    setStreamStatus("正在编辑消息。");
  }

  function startEditImage(message: MessageView) {
    if (!message.imageUrl) {
      return;
    }

    if (!imageGenerationAvailable) {
      setError("图片生成已在个人中心关闭，或当前处于安全模式。");
      return;
    }

    setEditingMessage(null);
    setSourceImageMessage(message);
    setImageToolEnabled(true);
    setWebSearchEnabledForMessage(false);
    setError("");
    setStreamStatus("已选择图片，可输入修改要求。");
    setComposerText("", true);
  }

  function cancelEditMessage() {
    setEditingMessage(null);
    setComposerText("");
    setStreamStatus("");
  }

  async function submitEditedMessage(
    prompt: string,
    useWebSearch: boolean,
    options: {
      disableMemoryWrite?: boolean;
      temporary?: boolean;
    } = {}
  ) {
    if (!editingMessage) {
      return;
    }

    const response = await fetch(`/api/messages/${editingMessage.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: prompt })
    });
    const payload = (await response.json().catch(() => null)) as
      | { message?: MessageView; error?: string }
      | null;

    if (!response.ok || !payload?.message) {
      setError(payload?.error || "编辑消息失败。");
      setStreamStatus("编辑失败。");
      return;
    }

    setMessages((current) => {
      const index = current.findIndex((message) => message.id === editingMessage.id);

      if (index < 0) {
        return current;
      }

      return [...current.slice(0, index), payload.message as MessageView];
    });
    setEditingMessage(null);

    if (payload.message.mode === "IMAGE") {
      await sendImage(prompt, payload.message.attachments ?? [], {
        reuseUserMessage: payload.message
      });
      return;
    }

    await sendChat(prompt, payload.message.attachments ?? [], {
      disableMemoryWrite: options.disableMemoryWrite,
      reuseUserMessage: payload.message,
      temporary: options.temporary,
      useWebSearch
    });
  }

  async function regenerateMessage(message: MessageView) {
    const previousUserMessage = findPreviousUserMessage(message.id);

    if (!previousUserMessage) {
      setError("没有找到可重新生成的上一条用户消息。");
      return;
    }

    setError("");
    setStreamStatus("正在重新生成...");

    try {
      if (previousUserMessage.mode === "IMAGE") {
        await sendImage(previousUserMessage.content, previousUserMessage.attachments ?? [], {
          reuseUserMessage: previousUserMessage
        });
        return;
      }

      await sendChat(previousUserMessage.content, previousUserMessage.attachments ?? [], {
        reuseUserMessage: previousUserMessage
      });
    } finally {
      void refreshMe();
    }
  }

  async function continueGenerating() {
    if (loading || quotaBlocked || conversationSwitching) {
      return;
    }

    setError("");

    try {
      await sendChat("请继续。", []);
    } finally {
      void refreshMe();
    }
  }

  async function send(draftText: string) {
    const attachments = pendingAttachments;
    const sourceImage = sourceImageMessage;
    const prompt =
      draftText.trim() ||
      (sourceImage
        ? "请基于这张图片生成新图片。"
        : attachments.length
          ? "请根据我上传的附件进行分析。"
          : "");

    if (
      (!prompt && attachments.length === 0 && !sourceImage) ||
      loading ||
      quotaBlocked ||
      uploadingAttachments ||
      conversationSwitching
    ) {
      return;
    }

    setPendingAttachments([]);
    setSourceImageMessage(null);
    setError("");
    setStreamStatus("");
    setToolEvents([]);
    setProcessMessageId(null);
    setProcessStartedAt(null);
    setProcessFinishedAt(null);

    try {
      const useWebSearch = webSearchToolAvailable && webSearchEnabledForMessage;
      const requestTemporary = temporaryChatEnabled;
      const requestDisableMemoryWrite = memoryWriteDisabledForConversation || requestTemporary;

      if (editingMessage) {
        setTemporaryChatEnabled(defaultTemporaryMode);
        setWebSearchEnabledForMessage(
          webSearchToolAvailable &&
            personalizationSettings.toolPreferences.webSearchDefault
        );
        await submitEditedMessage(prompt, useWebSearch, {
          disableMemoryWrite: requestDisableMemoryWrite,
          temporary: requestTemporary
        });
        return;
      }

      const imageToolRequested = imageGenerationAvailable && (imageToolEnabled || Boolean(sourceImage));
      setImageToolEnabled(false);
      setTemporaryChatEnabled(defaultTemporaryMode);
      setWebSearchEnabledForMessage(
        webSearchToolAvailable &&
          personalizationSettings.toolPreferences.webSearchDefault
      );

      await sendChat(prompt, attachments, {
        disableMemoryWrite: requestDisableMemoryWrite,
        imageToolRequested,
        sourceImageMessage: sourceImage,
        temporary: requestTemporary,
        useWebSearch
      });
    } finally {
      void refreshMe();
    }
  }

  const copyMessageHandler = useEventCallback(copyMessage);
  const deleteMessageHandler = useEventCallback(requestDeleteMessage);
  const confirmDeleteMessageHandler = useEventCallback(confirmDeleteMessage);
  const editMessageHandler = useEventCallback(startEditMessage);
  const editImageHandler = useEventCallback(startEditImage);
  const regenerateMessageHandler = useEventCallback(regenerateMessage);
  const continueGeneratingHandler = useEventCallback(continueGenerating);
  const sendHandler = useEventCallback(send);
  const stopGenerationHandler = useEventCallback(stopGeneration);
  const deleteMessagePreview = useMemo(() => {
    if (!deleteMessageTarget) {
      return "";
    }

    const content =
      deleteMessageTarget.role === "ASSISTANT"
        ? sanitizeIdentityLeak(deleteMessageTarget.content, deleteMessageTarget.model || "")
        : deleteMessageTarget.content;

    return content.trim() || (deleteMessageTarget.imageUrl ? "图片消息" : "空消息");
  }, [deleteMessageTarget]);

  const sidebarContent = (
    <>
      <div className="border-b border-[color:var(--ios-separator)] p-4 max-lg:border-b-0 max-lg:px-0 max-lg:pb-3 max-lg:pt-[calc(1rem+var(--app-safe-area-top,0px))]">
        <div className="flex items-center justify-between gap-3 max-lg:px-5 max-lg:pr-16">
          <div className="flex min-w-0 items-center gap-2">
            <SiteLogo className="hidden size-8 shrink-0 lg:block" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-stone-800 max-lg:text-[1.65rem] max-lg:font-bold max-lg:leading-9">
                {siteSettings.siteName}
              </p>
              <p className="mt-1 truncate text-xs ios-muted max-lg:hidden">{user.email}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              aria-expanded={desktopSidebarOpen}
              className={`${sidebarHeaderButtonClass} hidden lg:grid`}
              onClick={toggleSidebar}
              title="收起会话列表"
              type="button"
            >
              <Menu className="size-4" />
            </button>
            <button
              className={`${sidebarHeaderButtonClass} hidden lg:grid`}
              onClick={logout}
              title="退出登录"
              type="button"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
        <div className="mt-4 hidden gap-2 lg:flex">
          <button
            className="app-action-button app-glass-primary flex h-10 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition active:scale-[0.99]"
            onClick={() => startNewConversation()}
            type="button"
          >
            <MessageSquarePlus className="size-4" />
            新聊天
          </button>
        </div>
        <div className="mt-3 hidden lg:block">
          <label className="app-glass-control flex h-9 items-center gap-2 rounded-xl px-2.5 text-sm text-stone-700 max-lg:h-11 max-lg:rounded-2xl max-lg:px-3.5">
            <Search className="size-4 shrink-0 text-stone-400" />
            <input
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-stone-400 max-lg:text-[15px]"
              onChange={(event) => setConversationSearch(event.target.value)}
              placeholder="搜索聊天"
              value={conversationSearch}
            />
            {conversationSearch ? (
              <button
                className="grid size-5 shrink-0 place-items-center rounded-md text-stone-400 hover:bg-stone-200/70 hover:text-stone-700"
                onClick={() => setConversationSearch("")}
                title="清空搜索"
                type="button"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </label>
        </div>
        <div className="mx-5 mt-5 grid grid-cols-2 gap-2 lg:hidden" data-mobile-sidebar-actions>
          <button
            className="app-action-button flex h-11 min-w-0 items-center justify-center gap-2 rounded-2xl border border-white/50 bg-white/45 px-3 text-[15px] font-semibold text-stone-800 shadow-[0_12px_34px_rgba(18,42,35,0.1),inset_0_1px_0_rgba(255,255,255,0.72)] backdrop-blur-xl transition active:scale-[0.99]"
            onClick={() => startNewConversation()}
            type="button"
          >
            <MessageSquarePlus className="size-4 shrink-0" />
            <span className="min-w-0 truncate">新聊天</span>
          </button>
          <label className="app-glass-control flex h-11 min-w-0 items-center gap-2 rounded-2xl px-3.5 text-[15px] font-semibold text-stone-700">
            <Search className="size-4 shrink-0 text-stone-400" />
            <input
              className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none placeholder:text-stone-400"
              onChange={(event) => setConversationSearch(event.target.value)}
              placeholder="搜索聊天"
              value={conversationSearch}
            />
            {conversationSearch ? (
              <button
                className="grid size-5 shrink-0 place-items-center rounded-md text-stone-400 hover:bg-stone-200/70 hover:text-stone-700"
                onClick={() => setConversationSearch("")}
                title="清空搜索"
                type="button"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </label>
        </div>
      </div>

      <div className="hidden border-b border-white/40 p-2.5 lg:block lg:p-4">
        <UsageBars
          onRecharge={() => setPaymentDialogOpen(true)}
          paymentEnabled={paymentSettings.easyPayEnabled}
          usage={usage}
        />
      </div>

      <div
        className="mx-5 mb-2 mt-1 rounded-2xl border border-white/45 bg-white/36 px-3 py-2 shadow-[0_10px_30px_rgba(18,42,35,0.08),inset_0_1px_0_rgba(255,255,255,0.68)] backdrop-blur-xl lg:hidden"
        data-mobile-quota-card
      >
        <UsageBars
          compact
          onRecharge={() => setPaymentDialogOpen(true)}
          paymentEnabled={paymentSettings.easyPayEnabled}
          usage={usage}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 max-lg:px-5 max-lg:pb-20 max-lg:pt-1">
        {groupedConversations.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs leading-5 ios-muted">
            {conversationSearch.trim() ? "没有找到匹配的聊天。" : "暂无会话。"}
          </div>
        ) : null}

        {groupedConversations.map((group) => (
          <section className="mb-3 max-lg:mb-2" key={group.label}>
            <div className="px-0 py-2 text-[13px] font-semibold text-stone-500 lg:px-2 lg:py-1 lg:text-[11px]">
              {group.label}
            </div>
            <div className="space-y-1">
              {group.conversations.map((conversation) => {
                const active = conversation.id === activeConversationId;
                const menuOpen = openConversationMenuId === conversation.id;
                const running = runningGenerationKeySet.has(conversation.id);
                const renaming = renamingConversationId === conversation.id;

                return (
                  <div
                    className={`app-list-row group relative flex items-center gap-2 rounded-xl px-2 py-2.5 transition lg:rounded-lg lg:py-2 ${
                      menuOpen ? "z-30" : "z-0"
                    } ${
                      active
                        ? "border border-white/45 bg-white/48 text-stone-950 shadow-[0_10px_30px_rgba(18,42,35,0.08),inset_0_1px_0_rgba(255,255,255,0.72)] backdrop-blur-xl"
                        : "border border-transparent text-stone-700 hover:border-white/40 hover:bg-white/35 hover:shadow-[0_10px_28px_rgba(18,42,35,0.07)] hover:backdrop-blur-xl"
                    }`}
                    key={conversation.id}
                  >
                    {renaming ? (
                      <form
                        className="min-w-0 flex-1"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void submitRenameConversation(conversation.id);
                        }}
                      >
                        <input
                          autoFocus
                          className="h-8 w-full rounded-md border border-[color:var(--claude-accent)] bg-white px-2 text-sm font-medium text-stone-900 outline-none"
                          maxLength={80}
                          onBlur={() => void submitRenameConversation(conversation.id)}
                          onChange={(event) => setRenamingTitle(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              cancelRenameConversation();
                            }
                          }}
                          value={renamingTitle}
                        />
                      </form>
                    ) : (
                      <button
                        className="min-w-0 flex-1 text-left"
                        onClick={() => void openConversation(conversation.id)}
                        type="button"
                      >
                        <div className="flex min-w-0 items-center gap-1.5">
                          {conversation.pinned ? (
                            <Pin className="size-3.5 shrink-0 text-[color:var(--claude-accent)]" />
                          ) : null}
                          {running ? (
                            <Loader2 className="size-3.5 shrink-0 animate-spin text-[color:var(--claude-accent)]" />
                          ) : null}
                          <p className="min-w-0 truncate text-[15px] font-semibold leading-5 lg:text-sm lg:font-medium">
                            {conversation.title}
                          </p>
                        </div>
                        <p className="mt-0.5 truncate text-xs ios-muted max-lg:hidden">
                          {conversation.projectName ? `${conversation.projectName} · ` : ""}
                          {conversation.mode === "IMAGE" ? "image2" : conversation.model}
                          {conversation._count ? ` · ${conversation._count.messages} 条消息` : ""}
                          {running ? " · 生成中" : ""}
                        </p>
                      </button>
                    )}

                    {!renaming ? (
                      <button
                        data-conversation-menu
                        className={`app-action-button relative z-20 grid size-8 shrink-0 place-items-center rounded-lg text-stone-400 hover:bg-white/65 hover:text-stone-800 lg:size-7 ${
                          menuOpen ? "app-glass-control text-stone-800 opacity-100" : "lg:opacity-0 lg:group-hover:opacity-100"
                        }`}
                        onClick={() =>
                          setOpenConversationMenuId((current) =>
                            current === conversation.id ? null : conversation.id
                          )
                        }
                        title="会话操作"
                        type="button"
                      >
                        <MoreHorizontal className="size-4" />
                      </button>
                    ) : null}

                    {menuOpen ? (
                      <div
                        className="app-menu-enter app-glass-panel absolute right-10 top-1 z-40 w-36 overflow-hidden rounded-xl p-1 text-xs lg:right-9"
                        data-conversation-menu
                      >
                        <button
                          className="app-action-button flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-stone-700 hover:bg-[color:var(--app-accent-soft)]"
                          onClick={() => void togglePinConversation(conversation)}
                          type="button"
                        >
                          {conversation.pinned ? (
                            <PinOff className="size-3.5" />
                          ) : (
                            <Pin className="size-3.5" />
                          )}
                          {conversation.pinned ? "取消固定" : "固定"}
                        </button>
                        <button
                          className="app-action-button flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-stone-700 hover:bg-[color:var(--app-accent-soft)]"
                          onClick={() => beginRenameConversation(conversation)}
                          type="button"
                        >
                          <Pencil className="size-3.5" />
                          重命名
                        </button>
                        <button
                          className="app-action-button flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-stone-700 hover:bg-[color:var(--app-accent-soft)] disabled:opacity-50"
                          disabled={sharingConversationId === conversation.id}
                          onClick={() => void shareConversation(conversation)}
                          type="button"
                        >
                          <Share2 className="size-3.5" />
                          分享
                        </button>
                        <button
                          className="app-action-button flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-red-600 hover:bg-red-50"
                          onClick={() => requestDeleteConversation(conversation)}
                          type="button"
                        >
                          <Trash2 className="size-3.5" />
                          删除
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="m-3 hidden gap-2 lg:grid">
        <a
          className="app-action-button app-glass-control flex h-10 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold text-stone-700 transition"
          href="/profile"
        >
          <UserRound className="size-4" />
          个人中心
        </a>
        {user.role === "ADMIN" ? (
          <a
            className="app-action-button app-glass-control flex h-10 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold text-stone-700 transition"
            href="/admin"
          >
            <Shield className="size-4" />
            管理后台
          </a>
        ) : null}
      </div>
      <div className="mx-5 mb-[calc(0.75rem+env(safe-area-inset-bottom))] mt-2 grid gap-2 lg:hidden">
        <a
          className="app-action-button flex h-11 items-center gap-3 rounded-2xl border border-white/50 bg-white/45 px-3 text-[15px] font-semibold text-stone-700 shadow-[0_12px_34px_rgba(18,42,35,0.08),inset_0_1px_0_rgba(255,255,255,0.72)] backdrop-blur-xl transition active:scale-[0.99]"
          href="/profile"
        >
          <UserRound className="size-4" />
          个人中心
        </a>
        {user.role === "ADMIN" ? (
          <a
            className="app-action-button flex h-11 items-center gap-3 rounded-2xl border border-white/50 bg-white/45 px-3 text-[15px] font-semibold text-stone-700 shadow-[0_12px_34px_rgba(18,42,35,0.08),inset_0_1px_0_rgba(255,255,255,0.72)] backdrop-blur-xl transition active:scale-[0.99]"
            href="/admin"
          >
            <Shield className="size-4" />
            管理后台
          </a>
        ) : null}
      </div>
    </>
  );

  return (
    <main className="ios-page app-shell app-route-enter flex text-stone-950">
      <aside
        className={`ios-glass app-glass-sidebar app-sidebar-sheet hidden h-full w-80 shrink-0 border-r border-white/40 ${
          desktopSidebarOpen ? "lg:flex lg:flex-col" : "lg:hidden"
        }`}
      >
        {sidebarContent}
      </aside>

      {mobileSidebarOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="关闭侧栏"
            className="app-backdrop-enter absolute inset-0 bg-black/20"
            onClick={() => setMobileSidebarOpen(false)}
            type="button"
          />
          <aside className="ios-glass app-sidebar-sheet absolute inset-0 flex flex-col text-stone-950 shadow-none">
            <button
              className="app-action-button absolute right-5 top-[calc(1rem+var(--app-safe-area-top,0px))] z-20 grid size-10 place-items-center rounded-full border border-white/50 bg-white/45 text-[color:var(--app-ink-soft)] shadow-[0_12px_34px_rgba(18,42,35,0.12),inset_0_1px_0_rgba(255,255,255,0.72)] backdrop-blur-xl transition active:scale-95"
              onClick={() => setMobileSidebarOpen(false)}
              title="关闭"
              type="button"
            >
              <X className="size-[18px]" />
            </button>
            {sidebarContent}
          </aside>
        </div>
      ) : null}

      <section
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
        onDragEnter={handleFileDragEnter}
        onDragLeave={handleFileDragLeave}
        onDragOver={handleFileDragOver}
        onDrop={handleFileDrop}
      >
        {draggingFiles ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-3 z-40 grid place-items-center rounded-[1.25rem] border-2 border-dashed border-[color:var(--claude-accent)] bg-[color:var(--app-surface)] shadow-[0_24px_80px_rgba(18,42,35,0.18)] backdrop-blur-sm"
          >
            <div className="app-status-pill app-glass-control inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-stone-800">
              <Paperclip className="size-4 text-[color:var(--claude-accent)]" />
              松开以上传文件
            </div>
          </div>
        ) : null}
        <header className="app-header-enter app-glass-header relative z-30 shrink-0 px-3 pb-2 pt-[calc(0.5rem+var(--app-safe-area-top,0px))] sm:px-4 sm:py-3">
          {!desktopSidebarOpen ? (
            <button
              aria-expanded={desktopSidebarOpen}
              className="app-action-button app-glass-control absolute left-3 top-1/2 hidden size-8 -translate-y-1/2 place-items-center rounded-xl text-stone-500 transition hover:text-stone-900 lg:grid"
              onClick={toggleSidebar}
              title="展开会话列表"
              type="button"
            >
              <Menu className="size-3.5" />
            </button>
          ) : null}
          <div
            className={`mx-auto max-w-5xl ${
              desktopSidebarOpen ? "" : "lg:pl-10"
            }`}
            ref={headerControlsRef}
          >
            <div className="grid grid-cols-[2.5rem_auto_minmax(0,1fr)_2.5rem] items-center gap-2 lg:flex lg:items-center lg:justify-between lg:gap-3">
              <button
                aria-expanded={mobileSidebarOpen || desktopSidebarOpen}
                className="app-action-button grid size-10 shrink-0 place-items-center rounded-full border border-white/50 bg-white/45 text-[color:var(--app-ink-soft)] shadow-[0_12px_34px_rgba(18,42,35,0.12),inset_0_1px_0_rgba(255,255,255,0.72)] backdrop-blur-xl transition active:scale-95 lg:hidden"
                onClick={toggleSidebar}
                title="切换会话列表"
                type="button"
              >
                <Menu className="size-5" />
              </button>

              {activeModel ? (
                <div className="min-w-[4.75rem] justify-self-start lg:hidden">
                  <ContextBadge
                    compact
                    contextStats={lastContextStats}
                    contextWindowTokens={activeModel.contextWindowTokens}
                  />
                </div>
              ) : null}

              <div className="hidden min-w-0 flex-1 lg:block">
                <div className="flex min-w-0 items-center gap-1.5">
                  <p className="truncate text-sm font-semibold text-stone-950">
                    {activeConversation?.title || "新聊天"}
                  </p>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs ios-muted">
                  {activeProject ? <span className="min-w-0 truncate">项目 {activeProject.name}</span> : null}
                  <span className="min-w-0 truncate">余额 {formatCents(usage.remainingCostCents)}</span>
                  {activeModel ? (
                    <ContextBadge
                      contextStats={lastContextStats}
                      contextWindowTokens={activeModel.contextWindowTokens}
                    />
                  ) : null}
                </div>
              </div>

              <div className="min-w-0 justify-self-stretch lg:block lg:shrink-0 lg:justify-self-auto">
                <div className="flex w-full min-w-0 items-center gap-2 lg:w-auto">
                  {projects.length > 0 ? (
                    <label className="app-glass-control hidden h-10 min-w-0 items-center gap-2 rounded-2xl px-3 text-xs font-semibold text-stone-700 sm:flex">
                      <FolderOpen className="size-4 shrink-0 text-[color:var(--claude-accent)]" />
                      <select
                        className="max-w-36 min-w-0 bg-transparent outline-none lg:max-w-48"
                        onChange={(event) => void changeActiveProject(event.target.value)}
                        title="选择项目"
                        value={activeProjectId}
                      >
                        <option value="">账号默认</option>
                        {projects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <ModelReasoningPicker
                    activeModel={activeModel}
                    activeReasoningEffort={activeReasoningEffort}
                    models={chatModels}
                    modelValue={model}
                    onModelChange={setModel}
                    onOpenChange={setModelPickerOpen}
                    onReasoningChange={setReasoningEffort}
                    open={modelPickerOpen}
                    reasoningValue={reasoningEffort}
                  />
                </div>
              </div>

              <button
                className="app-action-button grid size-10 shrink-0 place-items-center rounded-full border border-white/50 bg-white/45 text-[color:var(--app-ink-soft)] shadow-[0_12px_34px_rgba(18,42,35,0.12),inset_0_1px_0_rgba(255,255,255,0.72)] backdrop-blur-xl transition active:scale-95 lg:hidden"
                onClick={() => startNewConversation()}
                title="新聊天"
                type="button"
              >
                <MessageSquarePlus className="size-5" />
              </button>
            </div>
          </div>
        </header>

        <div
          className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4 sm:py-6"
          onScroll={updateAutoScrollState}
          ref={messageScrollRef}
        >
          <div className="mx-auto flex max-w-4xl flex-col gap-7">
            {conversationSwitching && messages.length === 0 ? (
              <div className="app-empty-state grid min-h-[54vh] place-items-center text-center">
                <div className="app-status-pill app-glass-control inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-stone-700">
                  <Loader2 className="size-4 animate-spin text-[color:var(--claude-accent)]" />
                  加载会话中...
                </div>
              </div>
            ) : messages.length === 0 ? (
              <div className="app-empty-state grid min-h-[54vh] place-items-center text-center">
                <div>
                  <Sparkles className="mx-auto size-9 text-[color:var(--claude-accent)]" />
                  <h1 className="mt-4 text-2xl font-semibold text-stone-900 sm:text-3xl">
                    今天想聊点什么？
                  </h1>
                  <p className="mt-2 text-sm ios-muted">
                    {activeProject ? `${activeProject.name} · ` : ""}
                    {imageToolEnabled ? "image2" : activeModel?.label || model}
                  </p>
                </div>
              </div>
            ) : null}

            {messages.map((message) => {
              const inlineProcess =
                message.id === inlineProcessMessageId && processStartedAt && toolEvents.length > 0
                  ? {
                      events: toolEvents,
                      expanded: processTimelineExpanded,
                      finishedAt: processFinishedAt,
                      now: processNow,
                      onExpandedChange: setProcessTimelineExpanded,
                      startedAt: processStartedAt,
                      status: streamStatus
                    }
                  : null;

              return (
                <MessageBubble
                  inlineProcess={inlineProcess}
                  key={message.id}
                  message={message}
                  modelLabelById={messageModelLabels}
                  onContinue={continueGeneratingHandler}
                  onCopy={copyMessageHandler}
                  onDelete={deleteMessageHandler}
                  onEdit={editMessageHandler}
                  onEditImage={editImageHandler}
                  onRegenerate={regenerateMessageHandler}
                />
              );
            })}
            <div ref={scrollRef} />
          </div>
        </div>

        <footer className="shrink-0 border-t border-[color:var(--ios-separator)] bg-[color:var(--app-surface)] px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2 backdrop-blur sm:border-0 sm:bg-transparent sm:px-6 sm:pb-6 sm:pt-0 sm:backdrop-blur-none">
          <div className="mx-auto max-w-3xl">
            {activeModel ? (
              <ContextNotice
                lastContextStats={lastContextStats}
              />
            ) : null}
            {imageGenerationAvailable && imageToolEnabled ? (
              <div className="app-status-pill app-glass-control mb-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium text-stone-700">
                <ImageIcon className="size-3.5 text-[color:var(--claude-accent)]" />
                {sourceImageMessage
                  ? "下一条会优先走 image2 编辑所选图片"
                  : "下一条会优先走 image2 生图"}
              </div>
            ) : null}
            {webSearchToolAvailable && webSearchEnabledForMessage ? (
              <div className="app-status-pill app-glass-control mb-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium text-stone-700">
                <Search className="size-3.5 text-[color:var(--claude-accent)]" />
                下一条将联网搜索（{webSearchProviderLabel}）
              </div>
            ) : null}
            {temporaryChatEnabled || memoryWriteDisabledForConversation ? (
              <div className="app-status-pill app-glass-control mb-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium text-stone-700">
                <Shield className="size-3.5 text-[color:var(--claude-accent)]" />
                {temporaryChatEnabled ? "临时聊天：不保存历史，不读取或写入长期记忆" : "本次对话不写入记忆"}
              </div>
            ) : null}
            {toolEvents.length > 0 && processStartedAt && !inlineProcessMessageId ? (
              <ProcessTimelinePanel
                events={toolEvents}
                expanded={processTimelineExpanded}
                finishedAt={processFinishedAt}
                now={processNow}
                onExpandedChange={setProcessTimelineExpanded}
                startedAt={processStartedAt}
                status={streamStatus}
              />
            ) : streamStatus ? (
              <div className="app-status-pill app-glass-control mb-3 flex items-center gap-2 rounded-full px-3 py-1 text-xs text-stone-600">
                {loading ? <Loader2 className="size-3.5 animate-spin" /> : null}
                <span>{streamStatus}</span>
              </div>
            ) : null}
            {error && shouldShowInlineError(error) ? (
              <div className="app-inline-alert mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            ) : null}
            {quotaBlocked ? (
              <div className="app-inline-alert mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                余额不足，请联系管理员。
              </div>
            ) : null}
            {editingMessage ? (
              <div className="app-status-pill app-glass-control mb-2 flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs text-stone-700">
                <span className="min-w-0 truncate">正在编辑上一条消息</span>
                <button
                  className="shrink-0 font-semibold text-[color:var(--claude-accent)]"
                  onClick={cancelEditMessage}
                  type="button"
                >
                  取消
                </button>
              </div>
            ) : null}
            {sourceImageMessage?.imageUrl ? (
              <div className="app-status-pill app-glass-control mb-2 flex max-w-full items-center gap-2 rounded-xl px-2 py-2 text-xs text-stone-700">
                <img
                  alt="待编辑图片"
                  className="size-12 shrink-0 rounded-md object-cover"
                  src={sourceImageMessage.imageUrl}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-stone-900">正在编辑这张图片</div>
                  <div className="truncate ios-muted">输入修改要求后会优先走 image2 编辑</div>
                </div>
                <button
                  className="grid size-7 shrink-0 place-items-center rounded-md text-stone-500 hover:bg-stone-200/60 hover:text-stone-900"
                  onClick={() => {
                    setSourceImageMessage(null);
                    setImageToolEnabled(false);
                    setStreamStatus("");
                  }}
                  title="取消编辑图片"
                  type="button"
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : null}
            {pendingAttachments.length > 0 ? (
              <div className="mb-2 flex flex-wrap gap-2">
                {pendingAttachments.map((attachment) => (
                  <AttachmentChip
                    attachment={attachment}
                    key={attachment.id}
                    onRemove={() => removePendingAttachment(attachment.id)}
                  />
                ))}
              </div>
            ) : null}
            <div className="ios-panel app-glass-panel claude-composer app-composer flex min-h-11 items-center gap-1.5 px-1.5 py-0.5 sm:gap-2 sm:px-2">
              <input
                className="hidden"
                multiple
                onChange={(event) => void uploadAttachments(event.target.files)}
                ref={fileInputRef}
                type="file"
              />
              <div className="flex shrink-0 items-center gap-1">
                <button
                  className="app-action-button app-glass-control grid size-9 shrink-0 place-items-center rounded-full text-stone-600 transition disabled:opacity-50"
                  disabled={
                    !fileAnalysisAvailable ||
                    loading ||
                    quotaBlocked ||
                    uploadingAttachments ||
                    conversationSwitching
                  }
                  onClick={() => fileInputRef.current?.click()}
                  title={fileAnalysisAvailable ? "上传文件或图片" : "文件库或文件分析已关闭"}
                  type="button"
                >
                  {uploadingAttachments ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Paperclip className="size-4" />
                  )}
                </button>
                <button
                  className={`app-action-button grid size-9 shrink-0 place-items-center rounded-full border transition ${
                    imageToolEnabled
                      ? "border-[color:var(--claude-accent)] bg-[color:var(--app-accent-soft)] text-[color:var(--claude-accent-dark)]"
                      : "app-glass-control text-stone-600 sm:text-stone-600"
                  }`}
                  disabled={!imageGenerationAvailable || loading || quotaBlocked || conversationSwitching}
                  onClick={() => {
                    const nextImageToolEnabled = !imageToolEnabled;
                    setImageToolEnabled(nextImageToolEnabled);

                    if (!nextImageToolEnabled) {
                      setSourceImageMessage(null);
                    }

                    if (nextImageToolEnabled) {
                      setWebSearchEnabledForMessage(false);
                    }
                  }}
                  title={
                    imageGenerationAvailable
                      ? imageToolEnabled
                        ? "已开启：优先走 image2 生图"
                        : "优先走 image2 生图"
                      : "图片生成已关闭"
                  }
                  type="button"
                >
                  <ImageIcon className="size-4" />
                </button>
                {webSearchToolAvailable ? (
                  <div className="relative flex min-w-0 shrink-0 items-center">
                    <button
                      aria-pressed={webSearchEnabledForMessage}
                      className={`app-action-button grid size-9 place-items-center rounded-full border transition ${
                        webSearchEnabledForMessage
                          ? "border-[color:var(--claude-accent)] bg-[color:var(--app-accent-soft)] text-[color:var(--claude-accent-dark)]"
                          : "app-glass-control text-stone-600 sm:text-stone-600"
                      }`}
                      disabled={loading || quotaBlocked || conversationSwitching}
                      onClick={() => {
                        const nextWebSearchEnabled = !webSearchEnabledForMessage;
                        setWebSearchEnabledForMessage(nextWebSearchEnabled);

                        if (nextWebSearchEnabled) {
                          setImageToolEnabled(false);
                        }
                      }}
                      title={
                        webSearchEnabledForMessage
                          ? `已开启：下一条联网搜索（${webSearchProviderLabel}）`
                          : `下一条联网搜索（${webSearchProviderLabel}）`
                      }
                      type="button"
                    >
                      <Search className="size-4" />
                    </button>
                  </div>
                ) : null}
                <button
                  aria-pressed={temporaryChatEnabled}
                  className={`app-action-button grid size-9 shrink-0 place-items-center rounded-full border transition ${
                    temporaryChatEnabled
                      ? "border-[color:var(--claude-accent)] bg-[color:var(--app-accent-soft)] text-[color:var(--claude-accent-dark)]"
                      : "app-glass-control text-stone-600 sm:text-stone-600"
                  }`}
                  disabled={securityModeDefault || loading || quotaBlocked || conversationSwitching}
                  onClick={() => {
                    if (securityModeDefault) {
                      return;
                    }

                    const nextTemporaryChatEnabled = !temporaryChatEnabled;

                    setTemporaryChatEnabled(nextTemporaryChatEnabled);

                    if (nextTemporaryChatEnabled) {
                      setMemoryWriteDisabledForConversation(false);
                    }
                  }}
                  title={
                    securityModeDefault
                      ? "隐私 / 安全模式已强制开启临时聊天"
                      : temporaryChatEnabled
                      ? "已开启临时聊天：不保存历史，不读取或写入长期记忆"
                      : "临时聊天：不保存历史，不读取或写入长期记忆"
                  }
                  type="button"
                >
                  <Clock3 className="size-4" />
                </button>
                <button
                  aria-pressed={memoryWriteDisabledForConversation}
                  className={`app-action-button grid size-9 shrink-0 place-items-center rounded-full border transition ${
                    memoryWriteDisabledForConversation
                      ? "border-[color:var(--claude-accent)] bg-[color:var(--app-accent-soft)] text-[color:var(--claude-accent-dark)]"
                      : "app-glass-control text-stone-600 sm:text-stone-600"
                  }`}
                  disabled={temporaryChatEnabled || loading || quotaBlocked || conversationSwitching}
                  onClick={() => setMemoryWriteDisabledForConversation((current) => !current)}
                  title={
                    temporaryChatEnabled
                      ? "临时聊天已包含不写入记忆"
                      : memoryWriteDisabledForConversation
                        ? "已开启：本次对话不写入记忆"
                        : "本次对话不写入记忆"
                  }
                  type="button"
                >
                  <Shield className="size-4" />
                </button>
              </div>
              <ComposerInputArea
                disabled={conversationSwitching}
                draftFocusToken={composerDraft.focusToken}
                draftText={composerDraft.text}
                imageToolEnabled={imageGenerationAvailable && imageToolEnabled}
                loading={loading}
                onSend={sendHandler}
                onStop={stopGenerationHandler}
                pendingAttachmentCount={pendingAttachments.length}
                quotaBlocked={quotaBlocked}
                sourceImageSelected={Boolean(sourceImageMessage)}
                uploadingAttachments={uploadingAttachments}
                webSearchEnabledForMessage={webSearchToolAvailable && webSearchEnabledForMessage}
              />
            </div>
          </div>
        </footer>
      </section>
      <SiteConfirmDialog
        confirmLabel="删除会话"
        description={`确定删除「${deleteConversationTarget?.title || "这个会话"}」吗？删除后会话和其中的消息都会移除，此操作不可恢复。`}
        loading={Boolean(
          deleteConversationTarget && deletingConversationId === deleteConversationTarget.id
        )}
        onCancel={() => setDeleteConversationTarget(null)}
        onConfirm={() =>
          deleteConversationTarget ? deleteConversation(deleteConversationTarget.id) : undefined
        }
        open={Boolean(deleteConversationTarget)}
        title="删除会话"
        tone="danger"
      />
      <SiteConfirmDialog
        confirmLabel="删除消息"
        description={`确定删除这条${
          deleteMessageTarget?.role === "USER" ? "用户消息" : "AI 回复"
        }吗？删除后不可恢复。`}
        loading={Boolean(deleteMessageTarget && deletingMessageId === deleteMessageTarget.id)}
        onCancel={() => setDeleteMessageTarget(null)}
        onConfirm={confirmDeleteMessageHandler}
        open={Boolean(deleteMessageTarget)}
        title="删除消息"
        tone="danger"
      >
        {deleteMessageTarget ? (
          <div className="max-h-28 overflow-hidden rounded-xl border border-[color:var(--ios-separator)] bg-white/45 px-3 py-2 text-xs leading-5 text-stone-600">
            <p className="font-semibold text-stone-800">
              {deleteMessageTarget.role === "USER" ? "你发送的消息" : "AI 回复"}
            </p>
            <p className="mt-1 whitespace-pre-wrap break-words">{deleteMessagePreview}</p>
          </div>
        ) : null}
      </SiteConfirmDialog>
      <PaymentDialog
        onClose={() => setPaymentDialogOpen(false)}
        open={paymentDialogOpen}
        paymentSettings={paymentSettings}
      />
      <ShareNoticeToast
        notice={shareNotice}
        onCopy={() => void copyShareNoticeUrl()}
        onDismiss={() => setShareNotice(null)}
      />
    </main>
  );
}

function ShareNoticeToast({
  notice,
  onCopy,
  onDismiss
}: {
  notice: ShareNotice | null;
  onCopy: () => void;
  onDismiss: () => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !notice) {
    return null;
  }

  const success = notice.tone === "success";

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[75] grid place-items-center px-4 py-[calc(1rem+env(safe-area-inset-top))] sm:block sm:p-0">
      <section
        className={`app-reveal pointer-events-auto w-full max-w-[24rem] overflow-hidden rounded-2xl border bg-white/82 p-3 text-stone-900 shadow-[0_20px_70px_rgba(18,42,35,0.22),inset_0_1px_0_rgba(255,255,255,0.78)] backdrop-blur-2xl sm:absolute sm:right-6 sm:top-6 sm:w-[24rem] ${
          success ? "border-emerald-200" : "border-red-200"
        }`}
        role="status"
      >
        <div className="flex items-start gap-3">
          <span
            className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ${
              success ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"
            }`}
          >
            {success ? <Check className="size-4" /> : <X className="size-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-semibold leading-5">{notice.title}</p>
              <button
                className="app-action-button grid size-7 shrink-0 place-items-center rounded-full text-stone-400 transition hover:bg-white/70 hover:text-stone-900"
                onClick={onDismiss}
                title="关闭"
                type="button"
              >
                <X className="size-3.5" />
              </button>
            </div>
            {notice.description ? (
              <p className="mt-1 text-xs leading-5 text-stone-600">{notice.description}</p>
            ) : null}
            {notice.url ? (
              <div className="mt-3 flex items-center gap-2">
                <button
                  className="app-action-button app-glass-control flex h-9 flex-1 items-center justify-center gap-2 rounded-full px-3 text-xs font-semibold text-stone-700 transition"
                  onClick={onCopy}
                  type="button"
                >
                  <Copy className="size-3.5" />
                  复制链接
                </button>
                <a
                  className="app-action-button flex h-9 flex-1 items-center justify-center gap-2 rounded-full bg-[color:var(--claude-accent)] px-3 text-xs font-semibold text-white transition hover:bg-[color:var(--claude-accent-dark)]"
                  href={notice.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  <ExternalLink className="size-3.5" />
                  打开链接
                </a>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}

function PaymentDialog({
  onClose,
  open,
  paymentSettings
}: {
  onClose: () => void;
  open: boolean;
  paymentSettings: PublicPaymentSettingsView;
}) {
  const [amountCents, setAmountCents] = useState(1000);
  const [method, setMethod] = useState<EasyPayMethod>(
    paymentSettings.easyPayMethods[0] ?? "alipay"
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const balanceCents = calculatePaymentBalanceCents(
    amountCents,
    paymentSettings.easyPayBalanceCentsPerYuan
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!paymentSettings.easyPayMethods.includes(method)) {
      setMethod(paymentSettings.easyPayMethods[0] ?? "alipay");
    }
  }, [method, paymentSettings.easyPayMethods]);

  if (!mounted || !open) {
    return null;
  }

  async function startPayment() {
    setLoading(true);
    setError("");

    const popupWindow =
      paymentSettings.easyPayDisplayMode === "popup"
        ? window.open("about:blank", "easypay", "width=520,height=760")
        : null;

    if (popupWindow) {
      popupWindow.opener = null;
    }

    let response: Response;

    try {
      response = await fetch("/api/payments/easypay/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amountCents,
          method
        })
      });
    } catch {
      setError("网络异常，创建支付订单失败。");
      setLoading(false);
      popupWindow?.close();
      return;
    }

    const payload = (await response.json().catch(() => null)) as
      | { error?: string; paymentUrl?: string }
      | null;

    if (!response.ok || !payload?.paymentUrl) {
      setError(payload?.error || "创建支付订单失败。");
      setLoading(false);
      popupWindow?.close();
      return;
    }

    if (popupWindow) {
      popupWindow.location.href = payload.paymentUrl;
      setLoading(false);
      return;
    }

    window.location.href = payload.paymentUrl;
  }

  return createPortal(
    <div className="fixed inset-0 z-[90] grid place-items-center bg-stone-950/28 px-4 backdrop-blur-sm">
      <section className="app-reveal w-full max-w-md overflow-hidden rounded-2xl border border-white/55 bg-[color:var(--app-surface-solid)] p-4 text-stone-950 shadow-[0_24px_90px_rgba(18,42,35,0.28)]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="grid size-9 place-items-center rounded-lg bg-stone-100 text-[color:var(--claude-accent)]">
              <CreditCard className="size-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold">充值余额</h2>
              <p className="mt-0.5 text-xs ios-muted">支付完成后异步通知到账</p>
            </div>
          </div>
          <button
            className="app-action-button grid size-8 shrink-0 place-items-center rounded-lg text-stone-400 transition hover:bg-white/70 hover:text-stone-900"
            onClick={onClose}
            title="关闭"
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="grid gap-3">
          <div>
            <p className="mb-2 text-xs font-medium ios-muted">付款金额</p>
            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_AMOUNTS_CENTS.map((amount) => (
                <button
                  className={`app-action-button flex min-h-12 flex-col items-center justify-center rounded-lg border text-sm font-semibold ${
                    amountCents === amount
                      ? "border-[color:var(--claude-accent)] bg-white text-stone-950"
                      : "border-[color:var(--ios-separator)] bg-white/60 text-stone-600"
                  }`}
                  key={amount}
                  onClick={() => setAmountCents(amount)}
                  type="button"
                >
                  <span>{formatPaymentYuan(amount)}</span>
                  <span className="mt-0.5 text-[11px] font-medium ios-muted">
                    到账 {formatCents(
                      calculatePaymentBalanceCents(
                        amount,
                        paymentSettings.easyPayBalanceCentsPerYuan
                      )
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium ios-muted">自定义付款金额</span>
            <input
              className="ios-input w-full"
              min={1}
              onChange={(event) => {
                const value = Number(event.target.value);

                if (Number.isFinite(value)) {
                  setAmountCents(Math.max(100, Math.round(value * 100)));
                }
              }}
              step={0.01}
              type="number"
              value={amountCents / 100}
            />
          </label>
          <div className="rounded-lg border border-[color:var(--app-border)] bg-white/60 px-3 py-2 text-sm text-stone-700">
            支付 {formatPaymentYuan(amountCents)}，到账 {formatCents(balanceCents)} 余额
          </div>
          <div>
            <p className="mb-2 text-xs font-medium ios-muted">支付方式</p>
            <div className="grid grid-cols-2 gap-2">
              {paymentSettings.easyPayMethods.map((item) => (
                <button
                  className={`app-action-button h-10 rounded-lg border text-sm font-semibold ${
                    method === item
                      ? "border-[color:var(--claude-accent)] bg-white text-stone-950"
                      : "border-[color:var(--ios-separator)] bg-white/60 text-stone-600"
                  }`}
                  key={item}
                  onClick={() => setMethod(item)}
                  type="button"
                >
                  {PAYMENT_METHOD_LABELS[item]}
                </button>
              ))}
            </div>
          </div>
          {error ? (
            <div className="app-inline-alert rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}
          <button
            className="ios-button-primary app-action-button flex h-11 items-center justify-center gap-2 px-4 disabled:opacity-60"
            disabled={loading || !paymentSettings.easyPayEnabled}
            onClick={startPayment}
            type="button"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}
            {paymentSettings.easyPayDisplayMode === "popup" ? "打开支付窗口" : "去支付"}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}

const ComposerInputArea = memo(function ComposerInputArea({
  disabled = false,
  draftFocusToken,
  draftText,
  imageToolEnabled,
  loading,
  onSend,
  onStop,
  pendingAttachmentCount,
  quotaBlocked,
  sourceImageSelected,
  uploadingAttachments,
  webSearchEnabledForMessage
}: {
  disabled?: boolean;
  draftFocusToken: number;
  draftText: string;
  imageToolEnabled: boolean;
  loading: boolean;
  onSend: (draftText: string) => Promise<void>;
  onStop: () => void;
  pendingAttachmentCount: number;
  quotaBlocked: boolean;
  sourceImageSelected: boolean;
  uploadingAttachments: boolean;
  webSearchEnabledForMessage: boolean;
}) {
  const [draft, setDraft] = useState(draftText);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [fullscreenAvailable, setFullscreenAvailable] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fullscreenTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const placeholder = sourceImageSelected
    ? "描述想如何修改这张图片"
    : imageToolEnabled
      ? "描述要生成的图片"
      : webSearchEnabledForMessage
        ? "输入需要联网查询的问题"
        : "问问 AI";
  const sendDisabled =
    disabled ||
    (!loading && !draft.trim() && pendingAttachmentCount === 0 && !sourceImageSelected) ||
    quotaBlocked ||
    uploadingAttachments;
  const composerDisabled = disabled || loading || quotaBlocked;
  const fullscreenButtonVisible = fullscreenAvailable && !composerDisabled;

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    const minHeight = composerTextareaMinHeight();
    textarea.style.height = `${minHeight}px`;
    const contentHeight = textarea.scrollHeight;
    const nextHeight = Math.min(
      COMPOSER_TEXTAREA_MAX_HEIGHT,
      Math.max(minHeight, contentHeight)
    );

    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY =
      contentHeight > COMPOSER_TEXTAREA_MAX_HEIGHT ? "auto" : "hidden";
    setFullscreenAvailable(contentHeight >= COMPOSER_FULLSCREEN_THRESHOLD);
  }, []);

  useEffect(() => {
    setDraft(draftText);

    if (draftFocusToken > 0) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [draftFocusToken, draftText]);

  useEffect(() => {
    resizeTextarea();
  }, [draft, resizeTextarea]);

  useEffect(() => {
    window.addEventListener("resize", resizeTextarea);
    return () => window.removeEventListener("resize", resizeTextarea);
  }, [resizeTextarea]);

  useEffect(() => {
    if (fullscreenOpen) {
      requestAnimationFrame(() => fullscreenTextareaRef.current?.focus());
    }
  }, [fullscreenOpen]);

  async function submitDraft() {
    if (loading) {
      onStop();
      return;
    }

    if (sendDisabled) {
      return;
    }

    const currentDraft = draft;
    setDraft("");
    setFullscreenOpen(false);
    await onSend(currentDraft);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitDraft();
    }
  }

  function onFullscreenKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setFullscreenOpen(false);
      return;
    }

    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submitDraft();
    }
  }

  return (
    <>
      <div className="flex min-h-9 w-full min-w-0 flex-1 items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          {fullscreenButtonVisible ? (
            <button
              className="app-action-button app-glass-control absolute right-1.5 top-1 z-10 grid size-7 place-items-center rounded-full text-stone-500 hover:text-stone-900"
              onClick={() => setFullscreenOpen(true)}
              title="全屏输入"
              type="button"
            >
              <Maximize2 className="size-3.5" />
            </button>
          ) : null}
          <textarea
            className={`block min-h-9 w-full min-w-0 resize-none bg-transparent px-2 py-1.5 text-base leading-6 text-stone-950 outline-none placeholder:text-stone-400 sm:text-sm ${
              fullscreenButtonVisible ? "pr-10" : ""
            }`}
            disabled={composerDisabled}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            ref={textareaRef}
            rows={1}
            value={draft}
          />
        </div>
        <button
          className="app-action-button app-glass-primary grid size-9 shrink-0 place-items-center self-center rounded-full transition disabled:bg-stone-300 disabled:text-white/80 disabled:opacity-70"
          disabled={sendDisabled}
          onClick={() => void submitDraft()}
          title={loading ? "停止生成" : disabled ? "会话加载中" : "发送"}
          type="button"
        >
          {loading ? <Square className="size-4" /> : <Send className="size-4" />}
        </button>
      </div>
      {fullscreenOpen
        ? createPortal(
            <div className="app-backdrop-enter fixed inset-0 z-[90] flex bg-[rgba(23,33,30,0.28)] p-3 backdrop-blur-md sm:p-6">
              <section className="app-dialog-panel mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/55 bg-[color:var(--app-surface-solid)] shadow-[0_28px_100px_rgba(23,33,30,0.28)]">
                <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[color:var(--ios-separator)] px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-stone-900">全屏输入</div>
                  </div>
                  <button
                    className="app-action-button app-glass-control grid size-9 shrink-0 place-items-center rounded-full text-stone-600"
                    onClick={() => setFullscreenOpen(false)}
                    title="关闭"
                    type="button"
                  >
                    <X className="size-4" />
                  </button>
                </header>
                <textarea
                  className="min-h-0 flex-1 resize-none bg-transparent px-4 py-4 text-base leading-7 text-stone-950 outline-none placeholder:text-stone-400"
                  disabled={composerDisabled}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={onFullscreenKeyDown}
                  placeholder={placeholder}
                  ref={fullscreenTextareaRef}
                  value={draft}
                />
                <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[color:var(--ios-separator)] px-4 py-3">
                  <button
                    className="app-action-button app-glass-control h-9 rounded-full px-4 text-sm font-medium text-stone-700"
                    onClick={() => setFullscreenOpen(false)}
                    type="button"
                  >
                    收起
                  </button>
                  <button
                    className="app-action-button app-glass-primary inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-semibold disabled:bg-stone-300 disabled:text-white/80 disabled:opacity-70"
                    disabled={sendDisabled}
                    onClick={() => void submitDraft()}
                    type="button"
                  >
                    {loading ? <Square className="size-4" /> : <Send className="size-4" />}
                    {loading ? "停止" : "发送"}
                  </button>
                </footer>
              </section>
            </div>,
            document.body
          )
        : null}
    </>
  );
});

function ModelReasoningPicker({
  activeModel,
  activeReasoningEffort,
  models,
  modelValue,
  onModelChange,
  onOpenChange,
  onReasoningChange,
  open,
  reasoningValue
}: {
  activeModel: ChatModelView | undefined;
  activeReasoningEffort: (typeof REASONING_EFFORTS)[number];
  models: ChatModelView[];
  modelValue: string;
  onModelChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onReasoningChange: (value: ReasoningEffort) => void;
  open: boolean;
  reasoningValue: ReasoningEffort;
}) {
  const reasoningSupported = activeModel?.supportsReasoning ?? true;
  const modelLabel = activeModel?.label || modelValue || "选择模型";
  const activeReasoningLabel = getReasoningUiCopy(activeReasoningEffort.id).label;
  const [portalReady, setPortalReady] = useState(false);
  const [useMobilePortal, setUseMobilePortal] = useState(false);

  useEffect(() => {
    setPortalReady(true);

    const mediaQuery = window.matchMedia("(max-width: 639px)");
    const syncPortalMode = () => setUseMobilePortal(mediaQuery.matches);
    syncPortalMode();
    mediaQuery.addEventListener("change", syncPortalMode);

    return () => mediaQuery.removeEventListener("change", syncPortalMode);
  }, []);

  const pickerPanel = open ? (
    <>
      <button
        aria-label="关闭模型选择"
        className="app-backdrop-enter fixed inset-0 z-40 bg-black/10 sm:hidden"
        onClick={() => onOpenChange(false)}
        type="button"
      />
      <div
        className="app-popover-enter app-glass-panel fixed bottom-2 left-2 right-2 z-50 flex max-h-[calc(100dvh_-_1rem)] min-h-0 flex-col overflow-hidden rounded-[1.35rem] p-2.5 ring-1 ring-white/70 sm:absolute sm:bottom-auto sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:max-h-[34rem] sm:w-[26rem] sm:rounded-[1.25rem] sm:p-2"
        data-model-picker-panel
      >
        <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-stone-300/70 sm:hidden" />
        <div className="flex items-center justify-between gap-3 px-2 py-1.5">
          <div>
            <p className="text-sm font-semibold text-stone-950">模型与思考</p>
            <p className="mt-0.5 text-[11px] text-stone-500">下一次回复生效</p>
          </div>
          <button
            className="app-action-button app-glass-control grid size-8 shrink-0 place-items-center rounded-full text-stone-500 transition hover:text-stone-950"
            onClick={() => onOpenChange(false)}
            title="关闭"
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pb-1 pr-1">
          <div className="mt-2 rounded-[1.05rem] border border-white/45 bg-white/58 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.62)] backdrop-blur-xl">
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-[11px] font-semibold text-stone-500">模型</span>
              <span className="text-[11px] text-stone-400">{formatNumber(models.length)}</span>
            </div>
            <div className="grid gap-1">
              {models.map((item) => {
                const selected = item.id === modelValue;
                const detail = getModelPickerDetail(item);

                return (
                  <button
                    className={`app-list-row group flex min-h-12 w-full min-w-0 items-center justify-between gap-3 rounded-[0.9rem] px-3 py-2 text-left text-sm transition sm:py-0 ${
                      selected
                        ? "bg-white/82 text-stone-950 shadow-[0_10px_26px_rgba(18,42,35,0.1)] ring-1 ring-[color:var(--app-accent-ring)] backdrop-blur-xl"
                        : "text-stone-700 hover:bg-white/62 hover:text-stone-950"
                    }`}
                    key={item.id}
                    onClick={() => onModelChange(item.id)}
                    type="button"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{item.label}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-stone-500">
                        {detail}
                      </span>
                    </span>
                    {selected ? (
                      <Check className="size-4 shrink-0 text-[color:var(--claude-accent-dark)]" />
                    ) : (
                      <span className="size-4 shrink-0 rounded-full border border-[color:var(--app-border-strong)] opacity-0 transition group-hover:opacity-100" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-2 rounded-[1.05rem] border border-white/45 bg-white/58 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.62)] backdrop-blur-xl">
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-[11px] font-semibold text-stone-500">思考强度</span>
              {!reasoningSupported ? (
                <span className="text-[11px] text-stone-500">可能不会生效</span>
              ) : null}
            </div>
            <div className="grid grid-cols-4 gap-1">
              {REASONING_EFFORTS.map((item) => {
                const selected = item.id === reasoningValue;
                const copy = getReasoningUiCopy(item.id);

                return (
                  <button
                    className={`app-list-row min-h-12 rounded-[0.9rem] px-1.5 text-center transition sm:px-2.5 sm:text-left ${
                      selected
                        ? "bg-white/82 text-stone-950 shadow-[0_10px_26px_rgba(18,42,35,0.1)] ring-1 ring-[color:var(--app-accent-ring)] backdrop-blur-xl"
                        : "text-stone-600 hover:bg-white/62 hover:text-stone-950"
                    }`}
                    key={item.id}
                    onClick={() => onReasoningChange(item.id)}
                    type="button"
                  >
                    <span className="block text-xs font-semibold">{copy.label}</span>
                    <span className="mt-0.5 block text-[11px] text-stone-500">{copy.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <button
          className="app-action-button app-glass-primary mt-2 flex h-10 w-full shrink-0 items-center justify-center rounded-full px-3 text-sm font-semibold transition"
          onClick={() => onOpenChange(false)}
          type="button"
        >
          完成
        </button>
      </div>
    </>
  ) : null;

  return (
    <div className="relative w-full sm:w-auto">
      <button
        aria-expanded={open}
        aria-label="选择模型和思考强度"
        className={`app-action-button flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-full border px-3 text-left text-[15px] font-semibold backdrop-blur-xl transition sm:h-9 sm:min-w-60 sm:px-3.5 sm:text-xs sm:font-medium ${
          open
            ? "border-white/75 bg-white/78 text-stone-950 shadow-[0_0_0_3px_rgba(19,81,68,0.10),0_16px_42px_rgba(18,42,35,0.14)]"
            : "app-glass-control text-stone-800"
        }`}
        onClick={() => onOpenChange(!open)}
        data-testid="model-reasoning-picker"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onOpenChange(false);
          }
        }}
        type="button"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[color:var(--app-accent-soft)] text-[color:var(--claude-accent-dark)]">
            <Sparkles className="size-3" />
          </span>
          <span className="min-w-0 truncate text-stone-950">
            <span className="sm:hidden">{modelLabel}</span>
            <span className="hidden sm:inline">{modelLabel}</span>
          </span>
          <span className="hidden text-stone-300 sm:inline">/</span>
          <span className="hidden shrink-0 text-stone-500 sm:inline">
            思考 {activeReasoningLabel}
          </span>
        </span>
        <ChevronDown
          className={`size-3.5 shrink-0 text-stone-500 transition ${open ? "rotate-180" : ""}`}
        />
      </button>

      {pickerPanel && useMobilePortal && portalReady
        ? createPortal(pickerPanel, document.body)
        : pickerPanel}
    </div>
  );
}

function getModelPickerDetail(model: ChatModelView) {
  const role =
    model.source === "upstream"
      ? "上游模型"
      : model.contextNote === "低成本"
        ? "轻量快速"
        : model.contextNote === "代码" || model.contextNote === "轻量代码"
          ? "轻量代码"
          : model.contextNote || "通用";

  return `${role} · ${formatCompactContext(model.contextWindowTokens)} 上下文`;
}

function getReasoningUiCopy(id: ReasoningEffort) {
  if (id === "low") {
    return { label: "快", hint: "日常" };
  }

  if (id === "high") {
    return { label: "深", hint: "复杂" };
  }

  if (id === "xhigh") {
    return { label: "最强", hint: "难题" };
  }

  return { label: "均衡", hint: "默认" };
}

function formatCompactContext(tokens: number) {
  if (tokens >= 1_000_000) {
    const value = tokens / 1_000_000;
    return Number.isInteger(value) ? `${value}M` : `${value.toFixed(1)}M`;
  }

  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}K`;
  }

  return formatNumber(tokens);
}

function ToolStatusIcon({ event }: { event: ToolEventView }) {
  if (event.status === "running") {
    return <Loader2 className="size-3.5 animate-spin" />;
  }

  if (event.status === "error") {
    return <X className="size-3.5" />;
  }

  if (event.status === "done") {
    return <Check className="size-3.5" />;
  }

  if (event.type === "web_search") {
    return <Search className="size-3.5" />;
  }

  if (event.type === "image") {
    return <ImageIcon className="size-3.5" />;
  }

  if (event.type === "attachments" || event.type === "file_analysis") {
    return <FileText className="size-3.5" />;
  }

  if (event.type === "memory") {
    return <UserRound className="size-3.5" />;
  }

  if (event.type === "context_compression") {
    return <Archive className="size-3.5" />;
  }

  return <Sparkles className="size-3.5" />;
}

function eventStatusLabel(status: ToolEventView["status"]) {
  if (status === "running") {
    return "运行中";
  }

  if (status === "done") {
    return "完成";
  }

  if (status === "error") {
    return "失败";
  }

  return "跳过";
}

function toolEventDisplayLabel(event: ToolEventView) {
  if (event.id === "generation" && event.status === "running") {
    return GENERATION_THINKING_LABEL;
  }

  return event.label;
}

function toolEventDisplayDetail(event: ToolEventView) {
  if (event.id === "generation" && event.status === "running") {
    if (
      !event.detail ||
      event.detail === "等待模型输出" ||
      event.detail === "已创建会话并整理上下文"
    ) {
      return GENERATION_THINKING_DETAIL;
    }
  }

  return event.detail;
}

function processTimelineStatus(status: string, latestRunningEvent?: ToolEventView) {
  const trimmedStatus = status.trim();

  if (
    latestRunningEvent?.id === "generation" &&
    latestRunningEvent.status === "running" &&
    (!trimmedStatus || trimmedStatus === "处理中..." || trimmedStatus.includes("等待模型输出"))
  ) {
    return GENERATION_THINKING_STATUS;
  }

  if (trimmedStatus) {
    return trimmedStatus;
  }

  if (latestRunningEvent) {
    return toolEventDisplayDetail(latestRunningEvent) || toolEventDisplayLabel(latestRunningEvent);
  }

  return "";
}

const TOOL_EVENT_DISPLAY_ORDER: Record<ToolEventView["type"], number> = {
  router: 0,
  memory: 1,
  attachments: 2,
  web_search: 3,
  context_compression: 4,
  file_analysis: 4,
  generation: 5,
  image: 5,
  usage: 6
};

function processTimelineSortTime(event: ToolEventView) {
  if (event.type === "router") {
    return Number.NEGATIVE_INFINITY;
  }

  if (event.type === "usage") {
    return Number.POSITIVE_INFINITY;
  }

  return event.startedAt;
}

function sortProcessTimelineEvents(events: ToolEventView[]) {
  return events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => {
      const timeDiff = processTimelineSortTime(left.event) - processTimelineSortTime(right.event);

      if (timeDiff !== 0) {
        return timeDiff;
      }

      const orderDiff =
        TOOL_EVENT_DISPLAY_ORDER[left.event.type] - TOOL_EVENT_DISPLAY_ORDER[right.event.type];

      if (orderDiff !== 0) {
        return orderDiff;
      }

      return left.index - right.index;
    })
    .map(({ event }) => event);
}

function ProcessTimelinePanel({
  className = "",
  events,
  expanded,
  finishedAt,
  now,
  onExpandedChange,
  reasoning,
  startedAt,
  status
}: {
  className?: string;
  events: ToolEventView[];
  expanded: boolean;
  finishedAt: number | null;
  now: number;
  onExpandedChange: (expanded: boolean) => void;
  reasoning?: string;
  startedAt: number;
  status: string;
}) {
  const active = !finishedAt;
  const orderedEvents = sortProcessTimelineEvents(events);
  const elapsed = formatElapsedDuration((finishedAt ?? now) - startedAt);
  const latestRunningEvent = [...orderedEvents].reverse().find((event) => event.status === "running");
  const displayStatus = processTimelineStatus(status, latestRunningEvent);

  return (
    <div
      className={`app-reveal app-glass-control mb-2 rounded-2xl px-3 py-2 text-xs text-stone-700 sm:mb-3 sm:rounded-xl ${className}`}
    >
      <button
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 text-left"
        onClick={() => onExpandedChange(!expanded)}
        type="button"
      >
        <span className="flex min-w-0 items-center gap-2">
          {active ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-[color:var(--claude-accent)]" />
          ) : (
            <Check className="size-3.5 shrink-0 text-[color:var(--claude-accent)]" />
          )}
          <span className="shrink-0 font-semibold">{active ? "处理中" : "已处理"}</span>
          <span className="shrink-0 ios-muted">{elapsed}</span>
          <span className="min-w-0 truncate ios-muted">
            {displayStatus}
          </span>
        </span>
        <ChevronDown
          className={`size-3.5 shrink-0 text-stone-400 transition ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>
      {expanded ? (
        <div className="app-reveal mt-2 border-t border-[color:var(--ios-separator)] pt-2">
          {reasoning ? (
            <div className="mb-2 whitespace-pre-wrap break-words rounded-lg bg-white/35 px-3 py-2 leading-5 text-stone-600">
              {reasoning}
            </div>
          ) : null}
          <div className="space-y-2">
            {orderedEvents.map((event) => {
              const eventFinishedAt = event.finishedAt ?? (event.status === "running" ? now : event.startedAt);
              const eventElapsed = formatElapsedDuration(eventFinishedAt - event.startedAt);
              const eventDetail = toolEventDisplayDetail(event);
              const eventLabel = toolEventDisplayLabel(event);

              return (
                <div className="app-reveal flex min-w-0 items-start gap-2" key={event.id}>
                  <span
                    className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ${
                      event.status === "error"
                        ? "bg-red-50 text-red-700"
                        : event.status === "running"
                          ? "bg-[color:var(--app-accent-soft)] text-[color:var(--claude-accent-dark)]"
                          : "bg-stone-100 text-stone-500"
                    }`}
                  >
                    <ToolStatusIcon event={event} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium text-stone-800">{eventLabel}</span>
                      <span className="ios-muted">{eventStatusLabel(event.status)}</span>
                      <span className="ios-muted">{eventElapsed}</span>
                    </span>
                    {eventDetail ? (
                      <span className="mt-0.5 block break-words leading-5 ios-muted">
                        {eventDetail}
                      </span>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ContextBadge({
  compact = false,
  contextStats,
  contextWindowTokens
}: {
  compact?: boolean;
  contextStats: ContextStats | null;
  contextWindowTokens: number;
}) {
  const warned = Boolean(contextStats?.longContextThresholdExceeded);
  const usedTokens = contextStats?.promptTokensEstimate ?? 0;
  const windowTokens = contextStats?.contextWindowTokens ?? contextWindowTokens;
  const remainingTokens = Math.max(0, windowTokens - usedTokens);
  const compressedTitle =
    contextStats && contextStats.compressedHistoryMessageCount > 0
      ? `；已压缩 ${formatNumber(contextStats.compressedHistoryMessageCount)} 条历史，摘要约 ${formatNumber(contextStats.compressedSummaryTokens)} tokens`
      : "";

  return (
    <span
      className={`app-status-pill inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] ${
        warned
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-white/50 bg-white/40 text-stone-500 shadow-[0_8px_22px_rgba(18,42,35,0.08),inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-xl"
      }`}
      title={`上下文窗口 ${formatNumber(windowTokens)} tokens${compressedTitle}；后端按实际请求体估算，最终计费以上游 usage 为准。`}
    >
      {compact ? (
        <>
          <span className="shrink-0">剩余</span>
          <span className="min-w-0 truncate">
            {contextStats
              ? formatCompactContext(remainingTokens)
              : formatCompactContext(contextWindowTokens)}
          </span>
        </>
      ) : (
        <>
          <span className="shrink-0">上下文</span>
          {contextStats ? (
            <span className="min-w-0 truncate">
              已用约 {formatNumber(usedTokens)} · 剩余 {formatNumber(remainingTokens)}
            </span>
          ) : (
            <span className="min-w-0 truncate">剩余 {formatNumber(contextWindowTokens)}</span>
          )}
        </>
      )}
    </span>
  );
}

function ContextNotice({ lastContextStats }: { lastContextStats: ContextStats | null }) {
  if (!lastContextStats) {
    return null;
  }

  const shouldWarn =
    lastContextStats.longContextThresholdExceeded ||
    lastContextStats.omittedHistoryMessageCount > 0 ||
    lastContextStats.contextWindowPercent >= 70;

  if (!shouldWarn) {
    return null;
  }

  const message = lastContextStats.longContextThresholdExceeded
    ? "当前会话已进入长上下文区间，可能额外计费、变慢，并让模型注意力分散导致降智；建议开启新会话。"
    : lastContextStats.omittedHistoryMessageCount > 0
      ? `上轮请求已自动裁剪 ${formatNumber(lastContextStats.omittedHistoryMessageCount)} 条较早历史；需要完整上下文时建议开启新会话或手动整理摘要。`
      : "当前会话已经很长，后续可能需要裁剪早期历史；复杂问题建议新开会话。";

  return (
    <div className="app-inline-alert mb-2 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs leading-5 text-amber-900 shadow-[0_12px_34px_rgba(146,64,14,0.08)] backdrop-blur-xl">
      {message}
    </div>
  );
}

function UsageBars({
  compact = false,
  onRecharge,
  paymentEnabled,
  usage
}: {
  compact?: boolean;
  onRecharge: () => void;
  paymentEnabled: boolean;
  usage: UsageSummary;
}) {
  const costPercent = usagePercent(usage.costUsedCents, usage.monthlyCostLimitCents);

  if (compact) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-stone-800">
            <Gauge className="size-3.5 shrink-0 text-[color:var(--claude-accent)]" />
            <span className="shrink-0">余额</span>
            <span className="min-w-0 truncate ios-muted">
              剩余 {formatCents(usage.remainingCostCents)}
            </span>
          </div>
          {paymentEnabled ? (
            <button
              className="app-action-button shrink-0 rounded-lg bg-white/70 px-2 py-0.5 text-[10px] font-semibold text-[color:var(--claude-accent)] transition hover:bg-white"
              onClick={onRecharge}
              type="button"
            >
              充值
            </button>
          ) : null}
        </div>
        <div className="h-1 overflow-hidden rounded-full border border-white/45 bg-white/45 shadow-[inset_0_1px_2px_rgba(18,42,35,0.08)] backdrop-blur-xl">
          <div
            className="app-progress-fill h-full rounded-full bg-[color:var(--claude-accent)]"
            style={{ width: `${costPercent}%` }}
          />
        </div>
        <div className="flex items-center justify-between gap-2 text-[10px] leading-4 ios-muted">
          <span className="min-w-0 truncate">
            已用 {formatCents(usage.costUsedCents)} / {formatCents(usage.monthlyCostLimitCents)}
          </span>
          <span className="shrink-0">{costPercent}%</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 lg:space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-800 lg:gap-2 lg:text-sm">
          <Gauge className="size-3.5 text-[color:var(--claude-accent)] lg:size-4" />
          永久余额
        </div>
        {paymentEnabled ? (
          <button
            className="app-action-button rounded-lg bg-white/70 px-2 py-1 text-[11px] font-semibold text-[color:var(--claude-accent)] transition hover:bg-white"
            onClick={onRecharge}
            type="button"
          >
            充值
          </button>
        ) : null}
      </div>
      <div>
        <div className="mb-0.5 flex items-center justify-between gap-2 text-[11px] ios-muted lg:mb-1 lg:text-xs">
          <span>费用</span>
          <span>剩余 {formatCents(usage.remainingCostCents)}</span>
        </div>
        <p className="mb-1 text-[10px] ios-muted lg:text-[11px]">
          已用 {formatCents(usage.costUsedCents)} / {formatCents(usage.monthlyCostLimitCents)}
        </p>
        <div className="h-1.5 overflow-hidden rounded-full border border-white/45 bg-white/45 shadow-[inset_0_1px_2px_rgba(18,42,35,0.08)] backdrop-blur-xl lg:h-2">
          <div
            className="app-progress-fill h-full rounded-full bg-[color:var(--claude-accent)]"
            style={{
              width: `${costPercent}%`
            }}
          />
        </div>
        <p className="mt-1 text-[10px] leading-4 ios-muted lg:mt-2 lg:text-[11px] lg:leading-5">
          累计产生 {formatNumber(usage.messagesUsed)} 条记录 ·{" "}
          {formatNumber(usage.tokensUsed)} tokens
        </p>
      </div>
    </div>
  );
}

function AttachmentIcon({ attachment }: { attachment: AttachmentView }) {
  if (attachment.kind === "IMAGE") {
    return <ImageIcon className="size-4" />;
  }

  if (attachment.kind === "ARCHIVE") {
    return <FileArchive className="size-4" />;
  }

  if (attachment.kind === "SPREADSHEET") {
    return <Table2 className="size-4" />;
  }

  if (attachment.kind === "FILE") {
    return <FileIcon className="size-4" />;
  }

  return <FileText className="size-4" />;
}

function AttachmentChip({
  attachment,
  onRemove
}: {
  attachment: AttachmentView;
  onRemove?: () => void;
}) {
  return (
    <div className="app-chip app-glass-control inline-flex min-w-0 max-w-full items-center gap-2 rounded-xl px-2 py-1.5 text-xs text-stone-700">
      <span className="shrink-0 text-[color:var(--claude-accent)]">
        <AttachmentIcon attachment={attachment} />
      </span>
      <span className="min-w-0 truncate">{attachment.originalName}</span>
      <span className="shrink-0 ios-muted">{formatBytes(attachment.sizeBytes)}</span>
      {onRemove ? (
        <button
          className="app-action-button grid size-5 shrink-0 place-items-center rounded-md text-stone-500 hover:bg-stone-200/60 hover:text-stone-900"
          onClick={onRemove}
          title="移除附件"
          type="button"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function MessageAttachments({
  attachments,
  isUser
}: {
  attachments: AttachmentView[];
  isUser: boolean;
}) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {attachments.map((attachment) =>
        attachment.kind === "IMAGE" && attachment.previewUrl ? (
          <a
            className={`app-chip block overflow-hidden rounded-lg border ${
              isUser ? "border-white/30" : "border-[color:var(--ios-separator)]"
            }`}
            href={attachment.previewUrl}
            key={attachment.id}
            target="_blank"
          >
            <img
              alt={attachment.originalName}
              className="size-24 object-cover"
              src={attachment.previewUrl}
            />
          </a>
        ) : (
          <AttachmentChip attachment={attachment} key={attachment.id} />
        )
      )}
    </div>
  );
}

function MessageActionButton({
  children,
  onClick,
  title,
  tone = "default"
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
  tone?: "default" | "user";
}) {
  return (
    <button
      aria-label={title}
      className={`app-action-button transition ${
        tone === "user"
          ? "app-glass-control grid size-7 place-items-center rounded-lg text-stone-500 hover:text-stone-900"
          : "inline-flex h-7 items-center gap-1 rounded-lg border border-transparent px-2 text-xs text-stone-500 hover:border-white/45 hover:bg-white/40 hover:text-stone-900 hover:backdrop-blur-xl"
      }`}
      onClick={onClick}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}

function WebSourceCards({ sources }: { sources: NonNullable<MessageView["webSources"]> }) {
  if (sources.length === 0) {
    return null;
  }

  return (
    <div className="mt-3">
      <div className="mb-1.5 text-xs font-semibold text-stone-600">来源</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {sources.map((source, index) => (
          <a
            className="app-list-row app-glass-control group block min-w-0 rounded-xl px-3 py-2 text-xs text-stone-700 transition"
            href={source.url}
            key={`${source.url}-${index}`}
            rel="noreferrer"
            target="_blank"
          >
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-[color:var(--claude-accent)]">
              <span className="grid size-4 shrink-0 place-items-center rounded-full bg-[color:var(--app-accent-soft)]">
                {index + 1}
              </span>
              <span className="min-w-0 truncate">{source.displayUrl}</span>
              <ExternalLink className="size-3 shrink-0 opacity-0 transition group-hover:opacity-100" />
            </div>
            <div className="line-clamp-2 font-semibold leading-5 text-stone-900">
              {source.title}
            </div>
            {source.snippet ? (
              <div className="mt-1 line-clamp-2 leading-5 text-stone-500">{source.snippet}</div>
            ) : null}
          </a>
        ))}
      </div>
    </div>
  );
}

function reactNodeToText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(reactNodeToText).join("");
  }

  if (isValidElement<{ children?: ReactNode }>(node)) {
    return reactNodeToText(node.props.children);
  }

  return "";
}

function MarkdownCodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);
  const label = language || "代码";

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="claude-code-block">
      <div className="claude-code-header">
        <span className="truncate">{label}</span>
        <button className="claude-code-copy" onClick={copyCode} type="button">
          <Copy className="size-3.5" />
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre>
        <code className={language ? `language-${language}` : undefined}>{code}</code>
      </pre>
    </div>
  );
}

function MarkdownPre({ children }: { children?: ReactNode }) {
  const codeElement = Children.toArray(children).find(
    (child): child is ReactElement<{ className?: string; children?: ReactNode }> =>
      isValidElement<{ className?: string; children?: ReactNode }>(child)
  );
  const className = codeElement?.props.className || "";
  const language = className.match(/language-([^\s]+)/)?.[1] || "";
  const code = reactNodeToText(codeElement?.props.children ?? children).replace(/\n$/, "");

  return <MarkdownCodeBlock code={code} language={language} />;
}

const markdownComponents: Components = {
  code({ className, children, ...props }) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  pre({ children }) {
    return <MarkdownPre>{children}</MarkdownPre>;
  }
};

function getMessageModelTitle(message: MessageView, modelLabelById: ReadonlyMap<string, string>) {
  const rawModel = message.model?.trim();

  if (message.mode === "IMAGE" || rawModel === "image2") {
    return "image2";
  }

  if (!rawModel) {
    return "AI";
  }

  return modelLabelById.get(rawModel) ?? rawModel;
}

const MessageBubble = memo(function MessageBubble({
  inlineProcess,
  message,
  modelLabelById,
  onContinue,
  onCopy,
  onDelete,
  onEdit,
  onEditImage,
  onRegenerate
}: {
  inlineProcess?: InlineProcessView | null;
  message: MessageView;
  modelLabelById: ReadonlyMap<string, string>;
  onContinue: () => void;
  onCopy: (message: MessageView) => void | Promise<void>;
  onDelete: (message: MessageView) => void | Promise<void>;
  onEdit: (message: MessageView) => void;
  onEditImage: (message: MessageView) => void;
  onRegenerate: (message: MessageView) => void | Promise<void>;
}) {
  const isUser = message.role === "USER";
  const displayContent = isUser
    ? message.content
    : sanitizeIdentityLeak(message.content, message.model || "");
  const renderedContent = isUser ? displayContent : prepareMarkdownForRendering(displayContent);
  const displayReasoning = !isUser
    ? sanitizeReasoningContent(message.reasoningContent || "", message.model || "")
    : "";
  const showStandaloneReasoning = Boolean(displayReasoning && !inlineProcess);
  const canContinue = !isUser && !message.imageUrl && message.mode !== "IMAGE";
  const modelTitle = isUser ? "" : getMessageModelTitle(message, modelLabelById);

  return (
    <div className={`app-message flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`${
          isUser
            ? "flex max-w-[min(680px,86%)] flex-col items-end"
            : "min-w-0 w-full max-w-[760px]"
        }`}
      >
        <div
          className={`${
            isUser
              ? "max-w-full break-words rounded-2xl bg-[color:var(--claude-accent)] px-4 py-3 text-white shadow-sm"
            : "min-w-0 w-full px-1 py-1 text-stone-900"
        }`}
      >
        {!isUser ? (
          <div className="mb-2 flex min-w-0 items-center gap-1.5 px-0.5 text-xs font-semibold text-stone-500">
            <Sparkles className="size-3.5 shrink-0 text-[color:var(--claude-accent)]" />
            <span className="min-w-0 truncate">AI · {modelTitle}</span>
          </div>
        ) : null}
        {message.attachments?.length ? (
          <MessageAttachments attachments={message.attachments} isUser={isUser} />
        ) : null}
        {!isUser && inlineProcess ? (
          <ProcessTimelinePanel
            className={message.imageUrl ? "max-w-lg" : ""}
            events={inlineProcess.events}
            expanded={inlineProcess.expanded}
            finishedAt={inlineProcess.finishedAt}
            now={inlineProcess.now}
            onExpandedChange={inlineProcess.onExpandedChange}
            reasoning={displayReasoning}
            startedAt={inlineProcess.startedAt}
            status={inlineProcess.status}
          />
        ) : null}
        {message.imageUrl ? (
          <img
            alt={message.content}
            className="aspect-square w-full max-w-lg rounded-md object-cover"
            src={message.imageUrl}
          />
        ) : (
          <>
            {showStandaloneReasoning ? (
              <details className="app-glass-control mb-3 rounded-xl px-3 py-2 text-xs text-stone-600">
                <summary className="cursor-pointer select-none font-semibold text-stone-600">
                  思考过程
                </summary>
                <div className="mt-2 whitespace-pre-wrap break-words leading-5">
                  {displayReasoning}
                </div>
              </details>
            ) : null}
            {isUser ? (
              <p className="whitespace-pre-wrap break-words text-sm leading-6">{displayContent}</p>
            ) : (
              <div className="claude-markdown text-sm leading-6">
                <ReactMarkdown
                  components={markdownComponents}
                  rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
                  remarkPlugins={[remarkGfm, remarkMath]}
                >
                  {renderedContent}
                </ReactMarkdown>
              </div>
            )}
          </>
        )}
        {!isUser && message.webSources?.length ? (
          <WebSourceCards sources={message.webSources} />
        ) : null}
        {!isUser && (message.totalTokens > 0 || message.estimatedCostCents > 0) ? (
          <p className="mt-3 text-xs text-stone-500">
            {message.promptTokens > 0 ? `↓ ${formatNumber(message.promptTokens)}` : null}
            {message.promptTokens > 0 && message.completionTokens > 0 ? " · " : null}
            {message.completionTokens > 0 ? `↑ ${formatNumber(message.completionTokens)}` : null}
            {message.cachedPromptTokens > 0
              ? ` · 缓存 ${formatNumber(message.cachedPromptTokens)}`
              : null}
            {message.reasoningTokens > 0
              ? ` · 思考 ${formatNumber(message.reasoningTokens)}`
              : null}
            {message.usageSource === "estimated" ? " · 估算" : null}
            {" · "}
            {formatCents(message.estimatedCostCents)}
          </p>
        ) : null}
        {message.pending && !inlineProcess ? (
          <p className="mt-2 text-xs opacity-70">{GENERATION_THINKING_STATUS}</p>
        ) : null}
        </div>
        {!message.pending ? (
          <div
            className={`app-message-actions mt-1.5 flex flex-wrap gap-1 ${
              isUser ? "justify-end pr-1" : "justify-start px-1"
            }`}
          >
            {isUser ? (
              <MessageActionButton onClick={() => onEdit(message)} title="编辑" tone="user">
                <Pencil className="size-3.5" />
              </MessageActionButton>
            ) : (
              <>
                {message.imageUrl ? (
                  <MessageActionButton onClick={() => onEditImage(message)} title="编辑图片">
                    <ImageIcon className="size-3.5" />
                    编辑图片
                  </MessageActionButton>
                ) : null}
                <MessageActionButton onClick={() => void onRegenerate(message)} title="重新生成">
                  <RotateCcw className="size-3.5" />
                  重新生成
                </MessageActionButton>
                {canContinue ? (
                  <MessageActionButton onClick={() => onContinue()} title="继续生成">
                    <Send className="size-3.5" />
                    继续
                  </MessageActionButton>
                ) : null}
              </>
            )}
            <MessageActionButton
              onClick={() => void onCopy(message)}
              title="复制"
              tone={isUser ? "user" : "default"}
            >
              <Copy className="size-3.5" />
              {isUser ? null : "复制"}
            </MessageActionButton>
            <MessageActionButton
              onClick={() => void onDelete(message)}
              title="删除"
              tone={isUser ? "user" : "default"}
            >
              <Trash2 className="size-3.5" />
              {isUser ? null : "删除"}
            </MessageActionButton>
          </div>
        ) : null}
      </div>
    </div>
  );
});
