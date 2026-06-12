"use client";

import {
  Archive,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FileArchive,
  FileText,
  Gauge,
  Image as ImageIcon,
  Loader2,
  LogOut,
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
  Shield,
  Sparkles,
  Square,
  Table2,
  Trash2,
  X
} from "lucide-react";
import {
  Children,
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
import { DEFAULT_REASONING_EFFORT, REASONING_EFFORTS } from "@/lib/models";
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
  UserView
} from "@/types/gateway";

type ChatShellProps = {
  initialUser: UserView;
  initialSiteSettings: SiteSettingsView;
  initialUsage: UsageSummary;
  initialModels: ChatModelView[];
  initialDefaultReasoningEffort: ReasoningEffort;
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
const IMAGE_REQUEST_PATTERN =
  /(生图|生成图片|生成一张|画一张|画个|画幅|出图|绘制|设计.{0,12}(图|图片|海报|头像|logo|壁纸|封面|插画|表情包)|做.{0,12}(图|图片|海报|头像|logo|壁纸|封面|插画|表情包)|draw|generate an image|create an image|make an image|illustration|poster|logo|wallpaper)/i;

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

function shouldSendAsImageRequest(prompt: string) {
  return IMAGE_REQUEST_PATTERN.test(prompt);
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
    return "处理中...";
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

export function ChatShell({
  initialDefaultReasoningEffort,
  initialModels,
  initialSiteSettings,
  initialUser,
  initialUsage,
  initialWebSearchEnabled
}: ChatShellProps) {
  const [user] = useState(initialUser);
  const [siteSettings, setSiteSettings] = useState(initialSiteSettings);
  const [usage, setUsage] = useState(initialUsage);
  const [chatModels, setChatModels] = useState(initialModels);
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
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [imageToolEnabled, setImageToolEnabled] = useState(false);
  const [sourceImageMessage, setSourceImageMessage] = useState<MessageView | null>(null);
  const [webSearchAvailable, setWebSearchAvailable] = useState(initialWebSearchEnabled);
  const [webSearchEnabledForMessage, setWebSearchEnabledForMessage] = useState(false);
  const [model, setModel] = useState<string>(initialModels[0]?.id ?? "");
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(
    initialDefaultReasoningEffort
  );
  const [composerDraft, setComposerDraft] = useState<ComposerDraftState>({
    focusToken: 0,
    text: ""
  });
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentView[]>([]);
  const [editingMessage, setEditingMessage] = useState<MessageView | null>(null);
  const [error, setError] = useState("");
  const [runningGenerationKeys, setRunningGenerationKeys] = useState<string[]>([]);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [streamStatus, setStreamStatus] = useState("");
  const [toolEvents, setToolEvents] = useState<ToolEventView[]>([]);
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const headerControlsRef = useRef<HTMLDivElement | null>(null);
  const messageScrollRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const quotaBlocked = usage.remainingCostCents <= 0;
  const runningGenerationKeySet = useMemo(
    () => new Set(runningGenerationKeys),
    [runningGenerationKeys]
  );
  const loading = runningGenerationKeySet.has(activeConversationKey);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId),
    [activeConversationId, conversations]
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
  const sidebarHeaderButtonClass =
    "app-action-button min-h-9 min-w-9 shrink-0 place-items-center rounded-lg border border-[color:var(--ios-separator)] bg-[rgba(255,253,247,0.76)] text-[#4f4338] transition hover:bg-[rgba(255,253,247,0.98)] hover:text-[color:var(--claude-ink)] active:scale-95";
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
        webSearchEnabled?: boolean;
      };
      setUsage(payload.usage);

      if (payload.siteSettings) {
        setSiteSettings(payload.siteSettings);
      }

      if (payload.chatModels?.length) {
        setChatModels(payload.chatModels);
        setModel((current) =>
          payload.chatModels?.some((item) => item.id === current)
            ? current
            : payload.chatModels?.[0]?.id ?? current
        );
      }

      if (payload.defaultReasoningEffort) {
        setReasoningEffort(
          (current) => current || payload.defaultReasoningEffort || DEFAULT_REASONING_EFFORT
        );
      }

      if (typeof payload.webSearchEnabled === "boolean") {
        setWebSearchAvailable(payload.webSearchEnabled);

        if (!payload.webSearchEnabled) {
          setWebSearchEnabledForMessage(false);
        }
      }

    }
  }, []);

  const loadConversation = useCallback(async (conversationId: string) => {
    const requestSeq = conversationLoadRequestSeqRef.current + 1;
    conversationLoadRequestSeqRef.current = requestSeq;
    const response = await fetch(`/api/conversations/${conversationId}`);

    if (!response.ok || requestSeq !== conversationLoadRequestSeqRef.current) {
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
    const restoringInFlightChat = inFlightChat && !inFlightChat.processFinishedAt ? inFlightChat : null;
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
      setProcessStartedAt(restoredProcessMessage.processStartedAt ?? null);
      setProcessFinishedAt(restoredProcessMessage.processFinishedAt ?? null);
      setProcessNow(restoredProcessMessage.processFinishedAt ?? Date.now());
    } else {
      setStreamStatus("");
      setToolEvents([]);
      setProcessStartedAt(null);
      setProcessFinishedAt(null);
    }

    if (payload.conversation.model && payload.conversation.model !== "image2") {
      setModel(payload.conversation.model);
    }
    setImageToolEnabled(false);
    setSourceImageMessage(null);
    setWebSearchEnabledForMessage(false);
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
    document.title = siteSettings.siteName;
  }, [siteSettings.siteName]);

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
    function closeMenus(event: MouseEvent) {
      const target = event.target;

      if (target instanceof Node && headerControlsRef.current?.contains(target)) {
        return;
      }

      if (target instanceof Element && target.closest("[data-model-picker-panel]")) {
        return;
      }

      setModelPickerOpen(false);
    }

    document.addEventListener("mousedown", closeMenus);

    return () => document.removeEventListener("mousedown", closeMenus);
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
    setMessages([]);
    setPendingAttachments([]);
    setEditingMessage(null);
    setError("");
    setLastContextStats(null);
    setStreamStatus("");
    setToolEvents([]);
    setProcessStartedAt(null);
    setProcessFinishedAt(null);
    setImageToolEnabled(false);
    setSourceImageMessage(null);
    setWebSearchEnabledForMessage(false);
    setMobileSidebarOpen(false);
    setOpenConversationMenuId(null);
    setRenamingConversationId(null);
    setRenamingTitle("");
    setComposerText("");
  }

  async function patchConversation(
    conversationId: string,
    body: { pinned?: boolean; title?: string }
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

  async function openConversation(conversationId: string) {
    autoScrollRef.current = true;
    setOpenConversationMenuId(null);
    await loadConversation(conversationId);
    setMobileSidebarOpen(false);
  }

  function toggleSidebar() {
    if (window.matchMedia("(min-width: 1024px)").matches) {
      setDesktopSidebarOpen((current) => !current);
      return;
    }

    setMobileSidebarOpen(true);
  }

  async function uploadAttachments(files: FileList | null) {
    if (!files?.length || uploadingAttachments) {
      return;
    }

    setUploadingAttachments(true);
    setError("");

    const formData = new FormData();

    for (const file of Array.from(files)) {
      formData.append("files", file);
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
        setError(payload?.error || "附件上传失败。");
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
      imageToolRequested?: boolean;
      reuseUserMessage?: MessageView;
      sourceImageMessage?: MessageView | null;
      useWebSearch?: boolean;
    } = {}
  ) {
    const reuseUserMessage = options.reuseUserMessage;
    const reuseUserMessageId = reuseUserMessage?.id;
    const sourceImageMessageId = options.sourceImageMessage?.id;
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
          conversationId: startingConversationId,
          model,
          reasoningEffort,
          content: prompt,
          imageToolRequested: Boolean(options.imageToolRequested),
          reuseUserMessageId,
          sourceImageMessageId,
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

    setChatStreamStatus("工具路由完成，等待模型输出...");

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

        if (!nextConversationId) {
          return;
        }

        conversationKey = resolveInFlightConversationKey(conversationKey, nextConversationId);
        persistedConversationId = nextConversationId;
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
          localAssistant.conversationId = nextConversationId;

          if (currentInFlight) {
            storeInFlightChat(conversationKey, {
              ...currentInFlight,
              assistantMessage: nextAssistant,
              conversationId: nextConversationId
            });
          }

          if (isViewingInFlightChat()) {
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
            conversationId: nextConversationId
          }));
        }
        void refreshConversations();

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
            detail: "已创建会话并整理上下文",
            id: "generation",
            label: "模型生成",
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
            setChatStreamStatus(toolEvent.detail || `${toolEvent.label}中...`);
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
              detail: "正在流式输出回答",
              id: "generation",
              label: "模型生成",
              status: "running",
              type: "generation"
            });
            setChatStreamStatus("正在流式输出...");
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
              detail: "已更新本月用量和费用",
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

        const response = await fetch(`/api/conversations/${targetConversationId}`).catch(
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
            setProcessStartedAt(processMessage.processStartedAt ?? null);
            setProcessFinishedAt(processMessage.processFinishedAt ?? null);
            setProcessNow(processMessage.processFinishedAt ?? Date.now());
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
    const localUser = reuseUserMessage
      ? { ...reuseUserMessage, attachments, content: prompt, mode: "IMAGE" as const, model: "image2" }
      : { ...emptyMessage("USER", prompt, "IMAGE", attachments), model: "image2" };
    const localAssistant = { ...emptyMessage("ASSISTANT", "生成中...", "IMAGE"), model: "image2" };
    const controller = new AbortController();
    const processStart = Date.now();
    const startingConversationId = reuseUserMessage?.conversationId ?? activeConversationIdRef.current;
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

    try {
      const response = await fetch("/api/images", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          attachmentIds: attachments.map((attachment) => attachment.id),
          conversationId: startingConversationId,
          model: "image2",
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

      if (!response.ok || !payload?.assistantMessage || !payload.conversationId) {
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

      conversationKey = resolveInFlightConversationKey(conversationKey, payload.conversationId);
      const assistantMessage = { ...payload.assistantMessage, pending: false };
      const userMessage = payload.userMessage;

      if (isViewingConversationKey(conversationKey)) {
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

      finish("done", "图片已生成");
      await refreshConversations();
    } catch (error) {
      if (controller.signal.aborted) {
        finish("skipped", "已停止");
        return;
      }

      const message = error instanceof Error ? `生图失败：${error.message}` : "生图失败。";
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

  async function deleteMessage(message: MessageView) {
    const response = await fetch(`/api/messages/${message.id}`, {
      method: "DELETE"
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error || "删除消息失败。");
      return;
    }

    setMessages((current) => current.filter((item) => item.id !== message.id));
    await refreshConversations(activeConversationId ?? undefined);
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

  async function submitEditedMessage(prompt: string, useWebSearch: boolean) {
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
      reuseUserMessage: payload.message,
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
    if (loading || quotaBlocked) {
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
      uploadingAttachments
    ) {
      return;
    }

    setPendingAttachments([]);
    setSourceImageMessage(null);
    setError("");
    setStreamStatus("");
    setToolEvents([]);
    setProcessStartedAt(null);
    setProcessFinishedAt(null);

    try {
      const useWebSearch = webSearchAvailable && webSearchEnabledForMessage;

      if (editingMessage) {
        setWebSearchEnabledForMessage(false);
        await submitEditedMessage(prompt, useWebSearch);
        return;
      }

      const imageToolRequested =
        imageToolEnabled || Boolean(sourceImage) || shouldSendAsImageRequest(prompt);
      setImageToolEnabled(false);
      setWebSearchEnabledForMessage(false);

      if (imageToolRequested) {
        await sendImage(prompt, attachments, {
          sourceImageMessage: sourceImage
        });
        return;
      }

      await sendChat(prompt, attachments, {
        sourceImageMessage: sourceImage,
        useWebSearch
      });
    } finally {
      void refreshMe();
    }
  }

  const copyMessageHandler = useEventCallback(copyMessage);
  const deleteMessageHandler = useEventCallback(deleteMessage);
  const editMessageHandler = useEventCallback(startEditMessage);
  const editImageHandler = useEventCallback(startEditImage);
  const regenerateMessageHandler = useEventCallback(regenerateMessage);
  const continueGeneratingHandler = useEventCallback(continueGenerating);
  const sendHandler = useEventCallback(send);
  const stopGenerationHandler = useEventCallback(stopGeneration);

  const sidebarContent = (
    <>
      <div className="border-b border-[color:var(--ios-separator)] p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <SiteLogo className="size-8 shrink-0" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-stone-800">
                {siteSettings.siteName}
              </p>
              <p className="mt-1 truncate text-xs ios-muted">{user.email}</p>
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
              className={`${sidebarHeaderButtonClass} grid`}
              onClick={logout}
              title="退出登录"
              type="button"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            className="ios-button-primary flex h-10 flex-1 items-center justify-center gap-2 px-3 text-sm"
            onClick={() => startNewConversation()}
            type="button"
          >
            <MessageSquarePlus className="size-4" />
            新聊天
          </button>
        </div>
        <div className="mt-3">
          <label className="flex h-9 items-center gap-2 rounded-lg border border-[color:var(--ios-separator)] bg-white/60 px-2.5 text-sm text-stone-700">
            <Search className="size-4 shrink-0 text-stone-400" />
            <input
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-stone-400"
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

      <div className="border-b border-[color:var(--ios-separator)] p-2.5 lg:p-4">
        <UsageBars usage={usage} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {groupedConversations.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs leading-5 ios-muted">
            {conversationSearch.trim() ? "没有找到匹配的聊天。" : "暂无会话。"}
          </div>
        ) : null}

        {groupedConversations.map((group) => (
          <section className="mb-3" key={group.label}>
            <div className="bg-[rgba(251,247,239,0.9)] px-2 py-1 text-[11px] font-semibold text-stone-500 backdrop-blur lg:sticky lg:top-0 lg:z-10">
              {group.label}
            </div>
            <div className="space-y-1">
              {group.conversations.map((conversation) => {
                const active = conversation.id === activeConversationId;
                const running = runningGenerationKeySet.has(conversation.id);
                const renaming = renamingConversationId === conversation.id;

                return (
                  <div
                    className={`app-list-row group relative flex items-center gap-2 rounded-lg px-2 py-2 transition ${
                      active
                        ? "bg-stone-200/60 text-stone-950"
                        : "text-stone-700 hover:bg-white/60"
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
                          <p className="min-w-0 truncate text-sm font-medium">
                            {conversation.title}
                          </p>
                        </div>
                        <p className="mt-0.5 truncate text-xs ios-muted">
                          {conversation.mode === "IMAGE" ? "image2" : conversation.model}
                          {conversation._count ? ` · ${conversation._count.messages} 条消息` : ""}
                          {running ? " · 生成中" : ""}
                        </p>
                      </button>
                    )}

                    {!renaming ? (
                      <button
                        className="app-action-button grid size-8 shrink-0 place-items-center rounded-lg text-stone-400 hover:bg-white hover:text-stone-800 lg:size-7 lg:opacity-0 lg:group-hover:opacity-100"
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

                    {openConversationMenuId === conversation.id ? (
                      <div className="app-menu-enter absolute right-2 top-10 z-30 w-36 overflow-hidden rounded-lg border border-[color:var(--ios-separator)] bg-[color:var(--claude-surface)] p-1 text-xs shadow-[0_16px_38px_rgba(83,69,54,0.16)]">
                        <button
                          className="app-action-button flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-stone-700 hover:bg-[#f6eadf]"
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
                          className="app-action-button flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-stone-700 hover:bg-[#f6eadf]"
                          onClick={() => beginRenameConversation(conversation)}
                          type="button"
                        >
                          <Pencil className="size-3.5" />
                          重命名
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

      {user.role === "ADMIN" ? (
        <a
          className="ios-button-secondary m-3 flex h-10 items-center justify-center gap-2 text-sm"
          href="/admin"
        >
          <Shield className="size-4" />
          管理后台
        </a>
      ) : null}
    </>
  );

  return (
    <main className="ios-page app-shell app-route-enter flex text-stone-950">
      <aside
        className={`ios-glass app-sidebar-sheet hidden h-full w-80 shrink-0 border-r border-[color:var(--ios-separator)] ${
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
          <aside className="ios-glass app-sidebar-sheet absolute inset-y-0 left-0 flex w-[min(20rem,86vw)] flex-col border-r border-[color:var(--ios-separator)] shadow-[18px_0_45px_rgba(83,69,54,0.18)]">
            <div className="flex items-center justify-between border-b border-[color:var(--ios-separator)] px-4 py-3">
              <span className="text-sm font-semibold text-stone-800">会话</span>
              <button
                className="ios-icon-button"
                onClick={() => setMobileSidebarOpen(false)}
                title="关闭"
                type="button"
              >
                <X className="size-4" />
              </button>
            </div>
            {sidebarContent}
          </aside>
        </div>
      ) : null}

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="app-header-enter relative shrink-0 border-b border-[color:var(--ios-separator)] bg-[rgba(251,247,239,0.72)] px-3 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] backdrop-blur sm:px-4 sm:py-3">
          {!desktopSidebarOpen ? (
            <button
              aria-expanded={desktopSidebarOpen}
              className="app-action-button absolute left-3 top-1/2 hidden size-7 -translate-y-1/2 place-items-center rounded-md text-stone-500 transition hover:bg-white/70 hover:text-stone-900 lg:grid"
              onClick={toggleSidebar}
              title="展开会话列表"
              type="button"
            >
              <Menu className="size-3.5" />
            </button>
          ) : null}
          <div
            className={`mx-auto flex max-w-5xl items-start justify-between gap-2 sm:items-center sm:gap-3 ${
              desktopSidebarOpen ? "" : "lg:pl-10"
            }`}
          >
            <div className="flex min-w-0 flex-1 items-start">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <button
                    aria-expanded={mobileSidebarOpen || desktopSidebarOpen}
                    className="app-action-button grid size-7 shrink-0 place-items-center rounded-md text-stone-500 transition hover:bg-white/70 hover:text-stone-900 lg:hidden"
                    onClick={toggleSidebar}
                    title="切换会话列表"
                    type="button"
                  >
                    <Menu className="size-3.5" />
                  </button>
                  <p className="truncate text-sm font-semibold text-stone-950">
                    {activeConversation?.title || "新聊天"}
                  </p>
                </div>
                <div className="mt-1 hidden flex-wrap items-center gap-2 text-xs ios-muted sm:flex">
                  <span className="min-w-0 truncate">本月费用剩余 {formatCents(usage.remainingCostCents)}</span>
                  {activeModel ? (
                    <ContextBadge
                      contextStats={lastContextStats}
                      contextWindowTokens={activeModel.contextWindowTokens}
                    />
                  ) : null}
                </div>
                {activeModel ? (
                  <div className="mt-1 flex sm:hidden">
                    <ContextBadge
                      compact
                      contextStats={lastContextStats}
                      contextWindowTokens={activeModel.contextWindowTokens}
                    />
                  </div>
                ) : null}
              </div>
            </div>

            <div
              className="w-[min(15.5rem,62vw)] min-w-[8.5rem] shrink-0 sm:w-auto sm:min-w-0 sm:shrink-0"
              ref={headerControlsRef}
            >
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
        </header>

        <div
          className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4 sm:py-6"
          onScroll={updateAutoScrollState}
          ref={messageScrollRef}
        >
          <div className="mx-auto flex max-w-4xl flex-col gap-7">
            {messages.length === 0 ? (
              <div className="app-empty-state grid min-h-[54vh] place-items-center text-center">
                <div>
                  <Sparkles className="mx-auto size-9 text-[color:var(--claude-accent)]" />
                  <h1 className="mt-4 text-2xl font-semibold text-stone-900 sm:text-3xl">
                    今天想聊点什么？
                  </h1>
                  <p className="mt-2 text-sm ios-muted">
                    {imageToolEnabled ? "image2" : activeModel?.label || model}
                  </p>
                </div>
              </div>
            ) : null}

            {messages.map((message) => (
              <MessageBubble
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
            ))}
            <div ref={scrollRef} />
          </div>
        </div>

        <footer className="shrink-0 border-t border-[color:var(--ios-separator)] bg-[rgba(247,243,234,0.86)] px-3 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 backdrop-blur sm:border-0 sm:bg-transparent sm:px-6 sm:pb-6 sm:pt-0 sm:backdrop-blur-none">
          <div className="mx-auto max-w-3xl">
            {activeModel ? (
              <ContextNotice
                lastContextStats={lastContextStats}
              />
            ) : null}
            {imageToolEnabled ? (
              <div className="app-status-pill mb-2 inline-flex items-center gap-2 rounded-full border border-[color:var(--ios-separator)] bg-white/55 px-3 py-1 text-xs font-medium text-stone-700">
                <ImageIcon className="size-3.5 text-[color:var(--claude-accent)]" />
                {sourceImageMessage
                  ? "下一条会优先走 image2 编辑所选图片"
                  : "下一条会优先走 image2 生图"}
              </div>
            ) : null}
            {webSearchAvailable && webSearchEnabledForMessage ? (
              <div className="app-status-pill mb-2 inline-flex items-center gap-2 rounded-full border border-[color:var(--ios-separator)] bg-white/55 px-3 py-1 text-xs font-medium text-stone-700">
                <Search className="size-3.5 text-[color:var(--claude-accent)]" />
                下一条将联网搜索（{webSearchProviderLabel}）
              </div>
            ) : null}
            {toolEvents.length > 0 && processStartedAt ? (
              <ProcessTimelinePanel
                events={toolEvents}
                finishedAt={processFinishedAt}
                now={processNow}
                startedAt={processStartedAt}
                status={streamStatus}
              />
            ) : streamStatus ? (
              <div className="app-status-pill mb-3 flex items-center gap-2 text-xs text-stone-600">
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
                本月额度已用完，请联系管理员。
              </div>
            ) : null}
            {editingMessage ? (
              <div className="app-status-pill mb-2 flex items-center justify-between gap-2 rounded-lg border border-[color:var(--ios-separator)] bg-white/60 px-3 py-2 text-xs text-stone-700">
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
              <div className="app-status-pill mb-2 flex max-w-full items-center gap-2 rounded-lg border border-[color:var(--ios-separator)] bg-white/65 px-2 py-2 text-xs text-stone-700">
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
            <div className="ios-panel claude-composer app-composer flex min-h-14 flex-col gap-2 px-2 py-2 shadow-[0_16px_38px_rgba(83,69,54,0.12)] sm:flex-row sm:items-center sm:bg-white/90 sm:px-3 sm:shadow-[0_18px_70px_rgba(83,69,54,0.18)]">
              <input
                accept=".zip,application/zip,application/x-zip-compressed,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                multiple
                onChange={(event) => void uploadAttachments(event.target.files)}
                ref={fileInputRef}
                type="file"
              />
              <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:shrink-0">
                <button
                  className="app-action-button grid size-9 shrink-0 place-items-center rounded-full border border-[color:var(--ios-separator)] bg-white/55 text-stone-600 transition hover:bg-white/80 disabled:opacity-50"
                  disabled={loading || quotaBlocked || uploadingAttachments}
                  onClick={() => fileInputRef.current?.click()}
                  title="上传文件或图片"
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
                      ? "border-[color:var(--claude-accent)] bg-[#f3d8ca] text-[color:var(--claude-accent-dark)]"
                      : "border-[color:var(--ios-separator)] bg-white/55 text-stone-600 hover:bg-white/80"
                  }`}
                  disabled={loading || quotaBlocked}
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
                  title={imageToolEnabled ? "已开启：优先走 image2 生图" : "优先走 image2 生图"}
                  type="button"
                >
                  <ImageIcon className="size-4" />
                </button>
                {webSearchAvailable ? (
                  <div className="relative flex min-w-0 shrink-0 items-center">
                    <button
                      aria-pressed={webSearchEnabledForMessage}
                      className={`app-action-button grid size-9 place-items-center rounded-full border transition ${
                        webSearchEnabledForMessage
                          ? "border-[color:var(--claude-accent)] bg-[#f3d8ca] text-[color:var(--claude-accent-dark)]"
                          : "border-[color:var(--ios-separator)] bg-white/55 text-stone-600 hover:bg-white/80"
                      }`}
                      disabled={loading || quotaBlocked}
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
              </div>
              <ComposerInputArea
                draftFocusToken={composerDraft.focusToken}
                draftText={composerDraft.text}
                imageToolEnabled={imageToolEnabled}
                loading={loading}
                onSend={sendHandler}
                onStop={stopGenerationHandler}
                pendingAttachmentCount={pendingAttachments.length}
                quotaBlocked={quotaBlocked}
                sourceImageSelected={Boolean(sourceImageMessage)}
                uploadingAttachments={uploadingAttachments}
                webSearchEnabledForMessage={webSearchEnabledForMessage}
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
    </main>
  );
}

const ComposerInputArea = memo(function ComposerInputArea({
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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const placeholder = sourceImageSelected
    ? "描述想如何修改这张图片"
    : imageToolEnabled
      ? "描述要生成的图片"
      : webSearchEnabledForMessage
        ? "输入需要联网查询的问题"
        : "输入消息，或说“画一张”";
  const sendDisabled =
    (!loading && !draft.trim() && pendingAttachmentCount === 0 && !sourceImageSelected) ||
    quotaBlocked ||
    uploadingAttachments;

  useEffect(() => {
    setDraft(draftText);

    if (draftFocusToken > 0) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [draftFocusToken, draftText]);

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
    await onSend(currentDraft);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitDraft();
    }
  }

  return (
    <div className="flex min-h-9 w-full min-w-0 flex-1 items-center gap-2">
      <textarea
        className="max-h-32 min-h-9 min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm leading-6 text-stone-950 outline-none"
        disabled={loading || quotaBlocked}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        ref={textareaRef}
        rows={1}
        value={draft}
      />
      <button
        className="app-action-button grid size-9 shrink-0 place-items-center rounded-full bg-[color:var(--claude-accent)] text-white transition hover:bg-[color:var(--claude-accent-dark)] disabled:bg-stone-300"
        disabled={sendDisabled}
        onClick={() => void submitDraft()}
        title={loading ? "停止生成" : "发送"}
        type="button"
      >
        {loading ? <Square className="size-4" /> : <Send className="size-4" />}
      </button>
    </div>
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
        className="app-popover-enter fixed bottom-3 left-2 right-2 z-50 flex max-h-[calc(100dvh_-_1.5rem)] min-h-0 flex-col overflow-hidden rounded-[1.25rem] border border-[#eadfce] bg-[color:var(--claude-surface)] p-2 shadow-[0_24px_80px_rgba(83,69,54,0.18)] ring-1 ring-white/70 sm:absolute sm:bottom-auto sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:max-h-[34rem] sm:w-[26rem]"
        data-model-picker-panel
      >
        <div className="flex items-center justify-between gap-3 px-2 py-1.5">
          <div>
            <p className="text-sm font-semibold text-stone-950">模型与思考</p>
            <p className="mt-0.5 text-[11px] text-stone-500">下一次回复生效</p>
          </div>
          <button
            className="app-action-button grid size-8 shrink-0 place-items-center rounded-full text-stone-500 transition hover:bg-stone-100 hover:text-stone-950"
            onClick={() => onOpenChange(false)}
            title="关闭"
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pb-1 pr-1">
          <div className="mt-2 rounded-[1.05rem] bg-[#f6efe4] p-1">
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
                    className={`app-list-row group flex min-h-12 w-full min-w-0 items-center justify-between gap-3 rounded-[0.9rem] px-3 text-left text-sm transition ${
                      selected
                        ? "bg-[#fffaf4] text-stone-950 shadow-sm ring-1 ring-[rgba(201,100,66,0.22)]"
                        : "text-stone-700 hover:bg-[#fffaf4]/80 hover:text-stone-950"
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
                      <span className="size-4 shrink-0 rounded-full border border-[#dfd2c0] opacity-0 transition group-hover:opacity-100" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-2 rounded-[1.05rem] bg-[#f6efe4] p-1">
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-[11px] font-semibold text-stone-500">思考</span>
              {!reasoningSupported ? (
                <span className="text-[11px] text-stone-500">可能不会生效</span>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
              {REASONING_EFFORTS.map((item) => {
                const selected = item.id === reasoningValue;
                const copy = getReasoningUiCopy(item.id);

                return (
                  <button
                    className={`app-list-row min-h-12 rounded-[0.9rem] px-2.5 text-left transition ${
                      selected
                        ? "bg-[#fffaf4] text-stone-950 shadow-sm ring-1 ring-[rgba(201,100,66,0.22)]"
                        : "text-stone-600 hover:bg-[#fffaf4]/80 hover:text-stone-950"
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
          className="app-action-button mt-2 flex h-10 w-full shrink-0 items-center justify-center rounded-full bg-[color:var(--claude-accent)] px-3 text-sm font-semibold text-white transition hover:bg-[color:var(--claude-accent-dark)]"
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
        className={`app-action-button flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-full border px-3 text-left text-xs font-medium backdrop-blur transition sm:min-w-60 sm:px-3.5 ${
          open
            ? "border-stone-300 bg-white text-stone-950 shadow-[0_0_0_3px_rgba(120,113,108,0.10)]"
            : "border-black/10 bg-white/70 text-stone-800 shadow-[0_8px_28px_rgba(83,69,54,0.08)] hover:border-stone-300 hover:bg-white/95"
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
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[#f3d8ca] text-[color:var(--claude-accent-dark)]">
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
    return { label: "快速", hint: "轻任务" };
  }

  if (id === "high") {
    return { label: "深入", hint: "复杂" };
  }

  if (id === "xhigh") {
    return { label: "极致", hint: "最强" };
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

function ProcessTimelinePanel({
  events,
  finishedAt,
  now,
  startedAt,
  status
}: {
  events: ToolEventView[];
  finishedAt: number | null;
  now: number;
  startedAt: number;
  status: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const active = !finishedAt;
  const elapsed = formatElapsedDuration((finishedAt ?? now) - startedAt);
  const latestRunningEvent = [...events].reverse().find((event) => event.status === "running");

  return (
    <div className="app-reveal mb-3 rounded-lg border border-[color:var(--ios-separator)] bg-white/55 px-3 py-2 text-xs text-stone-700">
      <button
        className="flex w-full items-center justify-between gap-3 text-left"
        onClick={() => setExpanded((current) => !current)}
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
            {status || latestRunningEvent?.detail || latestRunningEvent?.label}
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
          <div className="space-y-2">
            {events.map((event) => {
              const eventFinishedAt = event.finishedAt ?? (event.status === "running" ? now : event.startedAt);
              const eventElapsed = formatElapsedDuration(eventFinishedAt - event.startedAt);

              return (
                <div className="app-reveal flex min-w-0 items-start gap-2" key={event.id}>
                  <span
                    className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ${
                      event.status === "error"
                        ? "bg-red-50 text-red-700"
                        : event.status === "running"
                          ? "bg-[#f3d8ca] text-[color:var(--claude-accent-dark)]"
                          : "bg-stone-100 text-stone-500"
                    }`}
                  >
                    <ToolStatusIcon event={event} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium text-stone-800">{event.label}</span>
                      <span className="ios-muted">{eventStatusLabel(event.status)}</span>
                      <span className="ios-muted">{eventElapsed}</span>
                    </span>
                    {event.detail ? (
                      <span className="mt-0.5 block break-words leading-5 ios-muted">
                        {event.detail}
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
      className={`app-status-pill inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${
        warned
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-[color:var(--ios-separator)] bg-white/45 text-stone-500"
      }`}
      title={`上下文窗口 ${formatNumber(windowTokens)} tokens${compressedTitle}；后端按实际请求体估算，最终计费以上游 usage 为准。`}
    >
      {compact ? (
        <>
          <span className="shrink-0">上下文</span>
          <span className="min-w-0 truncate">
            {contextStats
              ? `${formatCompactContext(usedTokens)} / ${formatCompactContext(windowTokens)}`
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
    <div className="app-inline-alert mb-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs leading-5 text-amber-900">
      {message}
    </div>
  );
}

function UsageBars({ usage }: { usage: UsageSummary }) {
  return (
    <div className="space-y-2 lg:space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-800 lg:gap-2 lg:text-sm">
        <Gauge className="size-3.5 text-[color:var(--claude-accent)] lg:size-4" />
        本月费用额度
      </div>
      <div>
        <div className="mb-0.5 flex items-center justify-between gap-2 text-[11px] ios-muted lg:mb-1 lg:text-xs">
          <span>费用</span>
          <span>剩余 {formatCents(usage.remainingCostCents)}</span>
        </div>
        <p className="mb-1 text-[10px] ios-muted lg:text-[11px]">
          已用 {formatCents(usage.costUsedCents)} / {formatCents(usage.monthlyCostLimitCents)}
        </p>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/80 lg:h-2">
          <div
            className="app-progress-fill h-full rounded-full bg-[color:var(--claude-accent)]"
            style={{
              width: `${usagePercent(usage.costUsedCents, usage.monthlyCostLimitCents)}%`
            }}
          />
        </div>
        <p className="mt-1 text-[10px] leading-4 ios-muted lg:mt-2 lg:text-[11px] lg:leading-5">
          本月已产生 {formatNumber(usage.messagesUsed)} 条记录 ·{" "}
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
    <div className="app-chip inline-flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-[color:var(--ios-separator)] bg-white/65 px-2 py-1.5 text-xs text-stone-700">
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
          ? "grid size-7 place-items-center rounded-md border border-[color:var(--ios-separator)] bg-white/55 text-stone-500 shadow-sm hover:bg-white/90 hover:text-stone-900"
          : "inline-flex h-7 items-center gap-1 rounded-md border border-transparent px-2 text-xs text-stone-500 hover:border-[color:var(--ios-separator)] hover:bg-white/55 hover:text-stone-900"
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
            className="app-list-row group block min-w-0 rounded-lg border border-[color:var(--ios-separator)] bg-white/55 px-3 py-2 text-xs text-stone-700 transition hover:bg-white/85"
            href={source.url}
            key={`${source.url}-${index}`}
            rel="noreferrer"
            target="_blank"
          >
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-[color:var(--claude-accent)]">
              <span className="grid size-4 shrink-0 place-items-center rounded-full bg-[#f3d8ca]">
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

function convertMathDelimiters(value: string) {
  return value
    .replace(/\\{1,2}\[([\s\S]*?)\\{1,2}\]/g, (_match, math: string) => {
      const trimmed = math.trim();
      return trimmed ? `\n\n$$\n${trimmed}\n$$\n\n` : "";
    })
    .replace(/\\{1,2}\(([\s\S]*?)\\{1,2}\)/g, (_match, math: string) => {
      const trimmed = math.trim();
      return trimmed ? `$${trimmed}$` : "";
    });
}

function normalizeMathInMarkdownText(value: string) {
  return value
    .split(/(`+[^`\n]*?`+)/g)
    .map((part) => (part.startsWith("`") ? part : convertMathDelimiters(part)))
    .join("");
}

function closeUnfinishedCodeFence(value: string) {
  const lines = value.split("\n");
  let openFence: "```" | "~~~" | null = null;

  for (const line of lines) {
    const fence = line.match(/^(\s*)(```|~~~)/)?.[2] as "```" | "~~~" | undefined;

    if (!fence) {
      continue;
    }

    if (!openFence) {
      openFence = fence;
      continue;
    }

    if (openFence === fence) {
      openFence = null;
    }
  }

  return openFence ? `${value}\n${openFence}` : value;
}

function prepareMarkdownForRendering(value: string) {
  const normalized = value
    .split(/((?:^|\n)(?:```|~~~)[\s\S]*?(?:\n(?:```|~~~)(?=\n|$)|$))/g)
    .map((part) =>
      /^(?:\n)?(?:```|~~~)/.test(part) ? part : normalizeMathInMarkdownText(part)
    )
    .join("");

  return closeUnfinishedCodeFence(normalized);
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
  message,
  modelLabelById,
  onContinue,
  onCopy,
  onDelete,
  onEdit,
  onEditImage,
  onRegenerate
}: {
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
        {message.imageUrl ? (
          <img
            alt={message.content}
            className="aspect-square w-full max-w-lg rounded-md object-cover"
            src={message.imageUrl}
          />
        ) : (
          <>
            {displayReasoning ? (
              <details className="mb-3 rounded-lg border border-[color:var(--ios-separator)] bg-white/45 px-3 py-2 text-xs text-stone-600">
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
        {message.pending ? <p className="mt-2 text-xs opacity-70">处理中</p> : null}
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
