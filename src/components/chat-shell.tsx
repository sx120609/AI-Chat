"use client";

import {
  Archive,
  ArchiveRestore,
  Check,
  CheckSquare,
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
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { sanitizeIdentityLeak, sanitizeReasoningContent } from "@/lib/identity";
import { DEFAULT_REASONING_EFFORT, REASONING_EFFORTS } from "@/lib/models";
import { formatCents, formatNumber } from "@/lib/format";
import { SiteLogo } from "@/components/site-logo";
import type {
  AttachmentView,
  ChatModelView,
  ConversationSummary,
  GenerationMode,
  MessageView,
  ReasoningEffort,
  SiteSettingsView,
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
  initialWebSearchProvider: string;
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

type ToolEventView = {
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
type ToolEventUpdate = Omit<ToolEventView, "finishedAt" | "startedAt"> &
  Partial<Pick<ToolEventView, "finishedAt" | "startedAt">>;

type WebSearchProviderOption = "auto" | "bing" | "duckduckgo" | "google";

type ComposerDraftState = {
  focusToken: number;
  text: string;
};

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

function isLikelyImagePrompt(prompt: string) {
  const normalized = prompt.trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  return (
    /^(画|绘制|生成|做|设计|创建|出)(一|个|张|幅)?.{0,12}(图|图片|图像|插画|海报|头像|壁纸|logo|表情包|照片|封面)/i.test(
      normalized
    ) ||
    /(生图|生成图片|画一张|画个|画幅|draw|generate an image|create an image|make an image|illustration|poster|logo|wallpaper)/i.test(
      normalized
    )
  );
}

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
  if (conversation.archivedAt) {
    return "已归档";
  }

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
  const order = ["固定", "今天", "昨天", "最近 7 天", "最近 30 天", "更早", "已归档"];
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

function normalizeWebSearchProviderOption(value: string): WebSearchProviderOption {
  if (value === "auto" || value === "bing" || value === "duckduckgo" || value === "google") {
    return value;
  }

  return "auto";
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
  initialWebSearchEnabled,
  initialWebSearchProvider
}: ChatShellProps) {
  const [user] = useState(initialUser);
  const [siteSettings, setSiteSettings] = useState(initialSiteSettings);
  const [usage, setUsage] = useState(initialUsage);
  const [chatModels, setChatModels] = useState(initialModels);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [conversationSearch, setConversationSearch] = useState("");
  const [showArchivedConversations, setShowArchivedConversations] = useState(false);
  const [renamingConversationId, setRenamingConversationId] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const [selectedConversationIds, setSelectedConversationIds] = useState<string[]>([]);
  const [selectingConversations, setSelectingConversations] = useState(false);
  const [openConversationMenuId, setOpenConversationMenuId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [imageToolEnabled, setImageToolEnabled] = useState(false);
  const [sourceImageMessage, setSourceImageMessage] = useState<MessageView | null>(null);
  const [webSearchAvailable, setWebSearchAvailable] = useState(initialWebSearchEnabled);
  const [webSearchEnabledForMessage, setWebSearchEnabledForMessage] = useState(false);
  const [webSearchProvider, setWebSearchProvider] = useState<WebSearchProviderOption>(
    normalizeWebSearchProviderOption(initialWebSearchProvider)
  );
  const [searchProviderMenuOpen, setSearchProviderMenuOpen] = useState(false);
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
  const [loading, setLoading] = useState(false);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [streamStatus, setStreamStatus] = useState("");
  const [toolEvents, setToolEvents] = useState<ToolEventView[]>([]);
  const [processStartedAt, setProcessStartedAt] = useState<number | null>(null);
  const [processFinishedAt, setProcessFinishedAt] = useState<number | null>(null);
  const [processNow, setProcessNow] = useState(Date.now());
  const [lastContextStats, setLastContextStats] = useState<ContextStats | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const autoScrollRef = useRef(true);
  const initialConversationsLoadedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const headerControlsRef = useRef<HTMLDivElement | null>(null);
  const messageScrollRef = useRef<HTMLDivElement | null>(null);
  const searchProviderMenuRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const quotaBlocked = usage.remainingCostCents <= 0;

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId),
    [activeConversationId, conversations]
  );
  const activeModel = useMemo(
    () => chatModels.find((item) => item.id === model) ?? chatModels[0],
    [chatModels, model]
  );
  const activeReasoningEffort = useMemo(
    () => REASONING_EFFORTS.find((item) => item.id === reasoningEffort) ?? REASONING_EFFORTS[0],
    [reasoningEffort]
  );
  const webSearchProviderLabel =
    webSearchProvider === "auto"
      ? "自动"
      : webSearchProvider === "bing"
        ? "Bing"
        : webSearchProvider === "google"
          ? "Google"
          : "DuckDuckGo";
  const selectedConversationIdSet = useMemo(
    () => new Set(selectedConversationIds),
    [selectedConversationIds]
  );
  const groupedConversations = useMemo(() => groupConversations(conversations), [conversations]);
  const sidebarHeaderButtonClass =
    "min-h-9 min-w-9 shrink-0 place-items-center rounded-lg border border-[color:var(--ios-separator)] bg-[rgba(255,253,247,0.76)] text-[#4f4338] transition hover:bg-[rgba(255,253,247,0.98)] hover:text-[color:var(--claude-ink)] active:scale-95";
  const setComposerText = useCallback((text: string, focus = false) => {
    setComposerDraft((current) => ({
      focusToken: focus ? current.focusToken + 1 : current.focusToken,
      text
    }));
  }, []);

  const refreshMe = useCallback(async () => {
    const response = await fetch("/api/me");

    if (response.ok) {
      const payload = (await response.json()) as {
        usage: UsageSummary;
        siteSettings?: SiteSettingsView;
        chatModels?: ChatModelView[];
        defaultReasoningEffort?: ReasoningEffort;
        webSearchEnabled?: boolean;
        webSearchProvider?: string;
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
    const response = await fetch(`/api/conversations/${conversationId}`);

    if (!response.ok) {
      return;
    }

    const payload = (await response.json()) as {
      conversation: ConversationSummary & { messages: MessageView[] };
      context?: ContextStats;
    };

    setActiveConversationId(payload.conversation.id);
    setMessages(payload.conversation.messages);
    setLastContextStats(payload.context ?? null);
    setToolEvents([]);
    setProcessStartedAt(null);
    setProcessFinishedAt(null);
    if (payload.conversation.model && payload.conversation.model !== "image2") {
      setModel(payload.conversation.model);
    }
    setImageToolEnabled(false);
    setSourceImageMessage(null);
    setWebSearchEnabledForMessage(false);
  }, []);

  const refreshConversations = useCallback(
    async (preferredId?: string, loadFirst = false) => {
      const params = new URLSearchParams();

      if (conversationSearch.trim()) {
        params.set("search", conversationSearch.trim());
      }

      if (showArchivedConversations) {
        params.set("includeArchived", "true");
      }

      const response = await fetch(
        `/api/conversations${params.toString() ? `?${params.toString()}` : ""}`
      );

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as { conversations: ConversationSummary[] };
      startTransition(() => {
        const conversationIds = new Set(
          payload.conversations.map((conversation) => conversation.id)
        );

        setConversations(payload.conversations);
        setSelectedConversationIds((current) =>
          current.filter((id) => conversationIds.has(id))
        );
      });

      const target = preferredId ?? (loadFirst ? payload.conversations[0]?.id : undefined);

      if (target) {
        await loadConversation(target);
      }
    },
    [conversationSearch, loadConversation, showArchivedConversations]
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
  }, [conversationSearch, refreshConversations, showArchivedConversations]);

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

      if (target instanceof Node && searchProviderMenuRef.current?.contains(target)) {
        return;
      }

      setModelPickerOpen(false);
      setSearchProviderMenuOpen(false);
    }

    document.addEventListener("mousedown", closeMenus);

    return () => document.removeEventListener("mousedown", closeMenus);
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  function startNewConversation() {
    autoScrollRef.current = true;
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
    setSelectedConversationIds([]);
    setSelectingConversations(false);
    setRenamingConversationId(null);
    setRenamingTitle("");
    setSearchProviderMenuOpen(false);
    setComposerText("");
  }

  async function patchConversation(
    conversationId: string,
    body: { archived?: boolean; pinned?: boolean; title?: string }
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

  async function toggleArchiveConversation(conversation: ConversationSummary) {
    const archived = !conversation.archivedAt;
    const updated = await patchConversation(conversation.id, { archived });

    if (!updated) {
      return;
    }

    setOpenConversationMenuId(null);
    setSelectedConversationIds((current) => current.filter((id) => id !== conversation.id));

    if (archived && !showArchivedConversations && activeConversationId === conversation.id) {
      startNewConversation();
    }

    await refreshConversations(archived ? undefined : updated.id);
    setStreamStatus(archived ? "会话已归档。" : "会话已恢复。");
  }

  async function deleteConversation(conversationId: string, skipConfirm = false) {
    if (!skipConfirm && !window.confirm("确定删除这个会话吗？此操作不可恢复。")) {
      return;
    }

    const response = await fetch(`/api/conversations/${conversationId}`, { method: "DELETE" });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error || "删除会话失败。");
      return;
    }

    if (activeConversationId === conversationId) {
      startNewConversation();
    }

    setSelectedConversationIds((current) => current.filter((id) => id !== conversationId));
    setOpenConversationMenuId(null);
    await refreshConversations();
    setStreamStatus("会话已删除。");
  }

  function toggleConversationSelection(conversationId: string) {
    setSelectedConversationIds((current) =>
      current.includes(conversationId)
        ? current.filter((id) => id !== conversationId)
        : [...current, conversationId]
    );
  }

  function stopSelectingConversations() {
    setSelectingConversations(false);
    setSelectedConversationIds([]);
  }

  async function deleteSelectedConversations() {
    if (selectedConversationIds.length === 0) {
      return;
    }

    if (
      !window.confirm(`确定删除选中的 ${selectedConversationIds.length} 个会话吗？此操作不可恢复。`)
    ) {
      return;
    }

    const ids = selectedConversationIds;
    const response = await fetch("/api/conversations/bulk", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids })
    });
    const payload = (await response.json().catch(() => null)) as
      | { deleted?: number; error?: string }
      | null;

    if (!response.ok) {
      setError(payload?.error || "批量删除失败。");
      return;
    }

    if (activeConversationId && ids.includes(activeConversationId)) {
      startNewConversation();
    }

    setSelectedConversationIds([]);
    setSelectingConversations(false);
    await refreshConversations();
    setStreamStatus(`已删除 ${formatNumber(payload?.deleted ?? ids.length)} 个会话。`);
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
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setLoading(false);
    setProcessFinishedAt(now);
    setStreamStatus("已停止。");
    setToolEvents((current) =>
      current.map((event) =>
        event.status === "running"
          ? { ...event, detail: "已停止", finishedAt: now, status: "skipped" }
          : event
      )
    );
    setMessages((current) =>
      current.map((message) => (message.pending ? { ...message, pending: false } : message))
    );
  }

  async function sendChat(
    prompt: string,
    attachments: AttachmentView[],
    options: { reuseUserMessage?: MessageView; useWebSearch?: boolean } = {}
  ) {
    const reuseUserMessage = options.reuseUserMessage;
    const reuseUserMessageId = reuseUserMessage?.id;
    const useWebSearch = Boolean(options.useWebSearch);
    const localUser = reuseUserMessage ?? emptyMessage("USER", prompt, "CHAT", attachments);
    const localAssistant = {
      ...emptyMessage("ASSISTANT", "", "CHAT"),
      model
    };
    const controller = new AbortController();
    const processStart = Date.now();

    abortControllerRef.current = controller;
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
    setToolEvents([
      createToolEvent(
        {
          detail: useWebSearch
            ? "已强制开启联网搜索，正在整理来源"
            : attachments.length
              ? "正在判断是否需要读取附件、搜索或直接对话"
              : "正在判断是否需要搜索或直接对话",
          id: "router",
          label: "自动路由",
          status: "running",
          type: "router"
        },
        processStart
      )
    ]);
    setStreamStatus(useWebSearch ? "正在联网搜索..." : "正在自动选择工具...");

    const finishProcess = () => {
      const now = Date.now();
      setProcessFinishedAt(now);
      setToolEvents((current) =>
        current.map((event) =>
          event.status === "running" ? { ...event, finishedAt: now, status: "skipped" } : event
        )
      );
    };

    let response: Response;

    try {
      response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: activeConversationId,
          model,
          reasoningEffort,
          content: prompt,
          reuseUserMessageId,
          useWebSearch,
          webSearchProvider,
          attachmentIds: attachments.map((attachment) => attachment.id)
        }),
        signal: controller.signal
      });
    } catch (fetchError) {
      finishProcess();

      if (controller.signal.aborted) {
        setStreamStatus("已停止。");
        return;
      }

      const message =
        fetchError instanceof Error ? `连接上游失败：${fetchError.message}` : "连接上游失败。";
      setMessages((current) =>
        current.map((item) =>
          item.id === localAssistant.id ? { ...item, content: message, pending: false } : item
        )
      );
      setError(message);
      setStreamStatus("连接失败。");
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

      setMessages((current) =>
        current.map((message) =>
          message.id === localAssistant.id
            ? { ...message, content: payload?.error || "发送失败。", pending: false }
            : message
        )
      );
      setError(payload?.error || "发送失败。");
      setStreamStatus("发送失败。");
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let resolvedConversationId = activeConversationId;
    let receivedDelta = false;
    let pendingContentDelta = "";
    let pendingReasoningDelta = "";
    let streamStatusStarted = false;
    let streamFlushTimer: ReturnType<typeof setTimeout> | null = null;

    setStreamStatus("工具路由完成，等待模型输出...");

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

      setMessages((current) =>
        current.map((message) =>
          message.id === localAssistant.id
            ? {
                ...message,
                content: contentDelta ? `${message.content}${contentDelta}` : message.content,
                reasoningContent: reasoningDelta
                  ? `${message.reasoningContent || ""}${reasoningDelta}`
                  : message.reasoningContent
              }
            : message
        )
      );
    };
    const scheduleStreamFlush = () => {
      if (!streamFlushTimer) {
        streamFlushTimer = setTimeout(flushPendingOutput, STREAM_RENDER_INTERVAL_MS);
      }
    };
    const upsertToolEvent = (toolEvent: ToolEventUpdate) => {
      const now = Date.now();
      setToolEvents((current) => mergeToolEvent(current, toolEvent, now));
    };

    const handleEvent = (event: SseEvent) => {
      if (event.event === "meta") {
        resolvedConversationId = event.data.conversationId as string;
        setActiveConversationId(resolvedConversationId);

        if (event.data.context) {
          setLastContextStats(event.data.context as ContextStats);
        }

        if (event.data.userMessage) {
          const userMessage = event.data.userMessage as MessageView;
          setMessages((current) =>
            current.map((message) => (message.id === localUser.id ? userMessage : message))
          );
        }

        upsertToolEvent({
          detail: "已创建会话并整理上下文",
          id: "generation",
          label: "模型生成",
          status: "running",
          type: "generation"
        });
      }

      if (event.event === "tool") {
        const toolEvent = event.data as Partial<ToolEventView>;

        if (toolEvent.id && toolEvent.label && toolEvent.type && toolEvent.status) {
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
            setStreamStatus(toolEvent.detail || `${toolEvent.label}中...`);
          } else if (toolEvent.status === "done") {
            setStreamStatus(toolEvent.detail || `${toolEvent.label}完成。`);
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
            setStreamStatus("正在流式输出...");
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
        clearStreamFlushTimer();
        pendingContentDelta = "";
        pendingReasoningDelta = "";
        const assistantMessage = event.data.assistantMessage as MessageView;
        setMessages((current) =>
          current.map((message) =>
            message.id === localAssistant.id ? { ...assistantMessage, pending: false } : message
          )
        );

        if (event.data.usage) {
          setUsage(event.data.usage as UsageSummary);
        }

        setToolEvents((current) =>
          mergeToolEvent(
            mergeToolEvent(current, {
              detail: receivedDelta ? "回答已生成" : "上游已完成，但没有返回可见文本",
              id: "generation",
              label: "模型生成",
              status: "done",
              type: "generation"
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
        setProcessFinishedAt(now);
        setStreamStatus(receivedDelta ? "已完成。" : "上游已完成，但没有返回可见文本。");
      }

      if (event.event === "error") {
        const now = Date.now();
        clearStreamFlushTimer();
        pendingContentDelta = "";
        pendingReasoningDelta = "";
        const message = String(event.data.error ?? "上游调用失败。");
        setMessages((current) =>
          current.map((item) =>
            item.id === localAssistant.id ? { ...item, content: message, pending: false } : item
          )
        );
        setError(message);
        setToolEvents((current) =>
          mergeToolEvent(current, {
            detail: message,
            id: "generation",
            label: "模型生成",
            status: "error",
            type: "generation"
          }, now)
        );
        setProcessFinishedAt(now);
        setStreamStatus("上游调用失败。");
      }
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
    } catch (streamError) {
      const now = Date.now();

      if (controller.signal.aborted) {
        flushPendingOutput();
        setProcessFinishedAt(now);
        setStreamStatus("已停止。");
        setToolEvents((current) =>
          current.map((event) =>
            event.status === "running"
              ? { ...event, detail: "已停止", finishedAt: now, status: "skipped" }
              : event
          )
        );
        setMessages((current) =>
          current.map((item) =>
            item.id === localAssistant.id ? { ...item, pending: false } : item
          )
        );
        return;
      }

      clearStreamFlushTimer();
      pendingContentDelta = "";
      pendingReasoningDelta = "";
      const message =
        streamError instanceof Error ? `流式连接中断：${streamError.message}` : "流式连接中断。";
      setMessages((current) =>
        current.map((item) =>
          item.id === localAssistant.id ? { ...item, content: message, pending: false } : item
        )
      );
      setError(message);
      setToolEvents((current) =>
        mergeToolEvent(current, {
          detail: message,
          id: "generation",
          label: "模型生成",
          status: "error",
          type: "generation"
        }, now)
      );
      setProcessFinishedAt(now);
      setStreamStatus("流式连接中断。");
    }

    flushPendingOutput();

    if (abortControllerRef.current === controller) {
      abortControllerRef.current = null;
    }

    await refreshConversations();
  }
  async function sendImage(
    prompt: string,
    attachments: AttachmentView[],
    sourceImage: MessageView | null = null,
    options: { reuseUserMessage?: MessageView } = {}
  ) {
    const reuseUserMessage = options.reuseUserMessage;
    const reuseUserMessageId = reuseUserMessage?.id;
    const localUser = reuseUserMessage
      ? { ...reuseUserMessage, attachments, content: prompt, mode: "IMAGE" as const, model: "image2" }
      : emptyMessage("USER", prompt, "IMAGE", attachments);
    const localAssistant = emptyMessage("ASSISTANT", "生成中...", "IMAGE");
    const controller = new AbortController();
    const processStart = Date.now();

    abortControllerRef.current = controller;
    autoScrollRef.current = true;
    setProcessStartedAt(processStart);
    setProcessFinishedAt(null);
    setProcessNow(processStart);
    setMessages((current) => {
      if (!reuseUserMessageId) {
        return [...current, localUser, localAssistant];
      }

      const userIndex = current.findIndex((message) => message.id === reuseUserMessageId);

      if (userIndex < 0) {
        return [...current, localUser, localAssistant];
      }

      return [...current.slice(0, userIndex), localUser, localAssistant];
    });
    scheduleMessagesToBottom();
    setToolEvents([
      createToolEvent(
        {
          detail:
            sourceImage || attachments.some((attachment) => attachment.kind === "IMAGE")
              ? "正在基于图片生成或编辑"
              : "正在根据文字生成图片",
          id: "image",
          label: "image2",
          status: "running",
          type: "image"
        },
        processStart
      )
    ]);
    setStreamStatus("正在提交生图请求...");

    let response: Response;

    try {
      response = await fetch("/api/images", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: activeConversationId,
          model,
          prompt,
          reuseUserMessageId,
          sourceImageMessageId: sourceImage?.id,
          attachmentIds: attachments.map((attachment) => attachment.id)
        }),
        signal: controller.signal
      });
    } catch (fetchError) {
      const now = Date.now();
      setProcessFinishedAt(now);
      setToolEvents((current) =>
        mergeToolEvent(current, {
          detail: fetchError instanceof Error ? fetchError.message : "生图请求失败",
          id: "image",
          label: "image2",
          status: controller.signal.aborted ? "skipped" : "error",
          type: "image"
        }, now)
      );

      if (controller.signal.aborted) {
        setStreamStatus("已停止。");
        setMessages((current) =>
          current.map((message) =>
            message.id === localAssistant.id ? { ...message, pending: false } : message
          )
        );
        return;
      }

      const message =
        fetchError instanceof Error ? `生图请求失败：${fetchError.message}` : "生图请求失败。";
      setMessages((current) =>
        current.map((item) =>
          item.id === localAssistant.id ? { ...item, content: message, pending: false } : item
        )
      );
      setError(message);
      setStreamStatus("生图失败。");
      return;
    }

    const payload = (await response.json().catch(() => null)) as
      | {
          error?: string;
          conversationId?: string;
          userMessage?: MessageView;
          assistantMessage?: MessageView;
          usage?: UsageSummary;
        }
      | null;

    if (!response.ok || !payload) {
      const now = Date.now();
      setProcessFinishedAt(now);
      setToolEvents((current) =>
        mergeToolEvent(current, {
          detail: payload?.error || "生图失败",
          id: "image",
          label: "image2",
          status: "error",
          type: "image"
        }, now)
      );
      setMessages((current) =>
        current.map((message) =>
          message.id === localAssistant.id
            ? { ...message, content: payload?.error || "生图失败。", pending: false }
            : message
        )
      );
      setError(payload?.error || "生图失败。");
      setStreamStatus("生图失败。");
      return;
    }

    if (payload.conversationId) {
      setActiveConversationId(payload.conversationId);
    }

    setMessages((current) =>
      current.map((message) => {
        if (message.id === localUser.id && payload.userMessage) {
          return payload.userMessage;
        }

        if (message.id === localAssistant.id && payload.assistantMessage) {
          return { ...payload.assistantMessage, pending: false };
        }

        return message;
      })
    );

    if (payload.usage) {
      setUsage(payload.usage);
    }

    const finishTime = Date.now();
    setToolEvents((current) =>
      mergeToolEvent(
        mergeToolEvent(current, {
          detail:
            sourceImage || attachments.some((attachment) => attachment.kind === "IMAGE")
              ? "图片编辑已完成"
              : "图片生成已完成",
          id: "image",
          label: "image2",
          status: "done",
          type: "image"
        }, finishTime),
        {
          detail: "已更新本月用量和费用",
          id: "usage",
          label: "用量统计",
          status: "done",
          type: "usage"
        },
        finishTime
      )
    );
    setProcessFinishedAt(finishTime);
    setStreamStatus("生图完成。");
    if (abortControllerRef.current === controller) {
      abortControllerRef.current = null;
    }
    await refreshConversations();
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
      await sendImage(prompt, payload.message.attachments ?? [], null, {
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
    setLoading(true);

    try {
      if (previousUserMessage.mode === "IMAGE") {
        await sendImage(previousUserMessage.content, previousUserMessage.attachments ?? [], null, {
          reuseUserMessage: previousUserMessage
        });
        return;
      }

      await sendChat(previousUserMessage.content, previousUserMessage.attachments ?? [], {
        reuseUserMessage: previousUserMessage
      });
    } finally {
      setLoading(false);
      void refreshMe();
    }
  }

  async function continueGenerating() {
    if (loading || quotaBlocked) {
      return;
    }

    setError("");
    setLoading(true);

    try {
      await sendChat("请继续。", []);
    } finally {
      setLoading(false);
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
    setLoading(true);

    try {
      const useWebSearch = webSearchAvailable && webSearchEnabledForMessage;

      if (editingMessage) {
        setWebSearchEnabledForMessage(false);
        await submitEditedMessage(prompt, useWebSearch);
        return;
      }

      const shouldGenerateImage = Boolean(sourceImage) || imageToolEnabled || isLikelyImagePrompt(prompt);

      if (shouldGenerateImage) {
        setImageToolEnabled(false);
        setWebSearchEnabledForMessage(false);
        await sendImage(prompt, attachments, sourceImage);
      } else {
        setWebSearchEnabledForMessage(false);
        await sendChat(prompt, attachments, { useWebSearch });
      }
    } finally {
      setLoading(false);
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
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            className={`flex h-8 items-center justify-center gap-1.5 rounded-lg border px-2 text-xs font-medium transition ${
              showArchivedConversations
                ? "border-[color:var(--claude-accent)] bg-[#f3d8ca] text-[color:var(--claude-accent-dark)]"
                : "border-[color:var(--ios-separator)] bg-white/45 text-stone-600 hover:bg-white/75"
            }`}
            onClick={() => setShowArchivedConversations((current) => !current)}
            type="button"
          >
            {showArchivedConversations ? (
              <ArchiveRestore className="size-3.5" />
            ) : (
              <Archive className="size-3.5" />
            )}
            {showArchivedConversations ? "全部会话" : "含归档"}
          </button>
          <button
            className={`flex h-8 items-center justify-center gap-1.5 rounded-lg border px-2 text-xs font-medium transition ${
              selectingConversations
                ? "border-[color:var(--claude-accent)] bg-[#f3d8ca] text-[color:var(--claude-accent-dark)]"
                : "border-[color:var(--ios-separator)] bg-white/45 text-stone-600 hover:bg-white/75"
            }`}
            onClick={() => {
              if (selectingConversations) {
                stopSelectingConversations();
                return;
              }

              setSelectingConversations(true);
              setOpenConversationMenuId(null);
            }}
            type="button"
          >
            <CheckSquare className="size-3.5" />
            {selectingConversations ? "取消选择" : "批量选择"}
          </button>
        </div>
      </div>

      <div className="border-b border-[color:var(--ios-separator)] p-4">
        <UsageBars usage={usage} />
      </div>

      {selectingConversations ? (
        <div className="border-b border-[color:var(--ios-separator)] bg-white/35 px-3 py-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium text-stone-700">
              已选 {formatNumber(selectedConversationIds.length)} 个
            </span>
            <div className="flex items-center gap-1.5">
              <button
                className="rounded-md px-2 py-1 text-stone-600 hover:bg-white/70"
                onClick={() =>
                  setSelectedConversationIds(
                    selectedConversationIds.length > 0 &&
                      selectedConversationIds.length === conversations.length
                      ? []
                      : conversations.map((conversation) => conversation.id)
                  )
                }
                type="button"
              >
                {selectedConversationIds.length > 0 &&
                selectedConversationIds.length === conversations.length
                  ? "清空"
                  : "全选"}
              </button>
              <button
                className="rounded-md px-2 py-1 font-semibold text-red-600 hover:bg-red-50 disabled:text-stone-300"
                disabled={selectedConversationIds.length === 0}
                onClick={() => void deleteSelectedConversations()}
                type="button"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {groupedConversations.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs leading-5 ios-muted">
            {conversationSearch.trim() ? "没有找到匹配的聊天。" : "暂无会话。"}
          </div>
        ) : null}

        {groupedConversations.map((group) => (
          <section className="mb-3" key={group.label}>
            <div className="sticky top-0 z-10 bg-[rgba(251,247,239,0.9)] px-2 py-1 text-[11px] font-semibold text-stone-500 backdrop-blur">
              {group.label}
            </div>
            <div className="space-y-1">
              {group.conversations.map((conversation) => {
                const active = conversation.id === activeConversationId;
                const selected = selectedConversationIdSet.has(conversation.id);
                const renaming = renamingConversationId === conversation.id;

                return (
                  <div
                    className={`group relative flex items-center gap-2 rounded-lg px-2 py-2 transition ${
                      active
                        ? "bg-stone-200/60 text-stone-950"
                        : selected
                          ? "bg-[#f3d8ca]/70 text-stone-900"
                          : "text-stone-700 hover:bg-white/60"
                    }`}
                    key={conversation.id}
                  >
                    {selectingConversations ? (
                      <button
                        className={`grid size-6 shrink-0 place-items-center rounded-md border ${
                          selected
                            ? "border-[color:var(--claude-accent)] bg-[color:var(--claude-accent)] text-white"
                            : "border-[color:var(--ios-separator)] bg-white/60 text-transparent"
                        }`}
                        onClick={() => toggleConversationSelection(conversation.id)}
                        title={selected ? "取消选择" : "选择会话"}
                        type="button"
                      >
                        <Check className="size-3.5" />
                      </button>
                    ) : null}

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
                          {conversation.archivedAt ? (
                            <Archive className="size-3.5 shrink-0 text-stone-400" />
                          ) : null}
                          <p className="min-w-0 truncate text-sm font-medium">
                            {conversation.title}
                          </p>
                        </div>
                        <p className="mt-0.5 truncate text-xs ios-muted">
                          {conversation.mode === "IMAGE" ? "image2" : conversation.model}
                          {conversation._count ? ` · ${conversation._count.messages} 条消息` : ""}
                        </p>
                      </button>
                    )}

                    {!selectingConversations && !renaming ? (
                      <button
                        className="grid size-8 shrink-0 place-items-center rounded-lg text-stone-400 hover:bg-white hover:text-stone-800 lg:size-7 lg:opacity-0 lg:group-hover:opacity-100"
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
                      <div className="absolute right-2 top-10 z-30 w-36 overflow-hidden rounded-lg border border-[color:var(--ios-separator)] bg-[color:var(--claude-surface)] p-1 text-xs shadow-[0_16px_38px_rgba(83,69,54,0.16)]">
                        <button
                          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-stone-700 hover:bg-[#f6eadf]"
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
                          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-stone-700 hover:bg-[#f6eadf]"
                          onClick={() => beginRenameConversation(conversation)}
                          type="button"
                        >
                          <Pencil className="size-3.5" />
                          重命名
                        </button>
                        <button
                          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-stone-700 hover:bg-[#f6eadf]"
                          onClick={() => void toggleArchiveConversation(conversation)}
                          type="button"
                        >
                          {conversation.archivedAt ? (
                            <ArchiveRestore className="size-3.5" />
                          ) : (
                            <Archive className="size-3.5" />
                          )}
                          {conversation.archivedAt ? "恢复" : "归档"}
                        </button>
                        <button
                          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-red-600 hover:bg-red-50"
                          onClick={() => void deleteConversation(conversation.id)}
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
    <main className="ios-page app-shell flex text-stone-950">
      <aside
        className={`ios-glass hidden h-full w-80 shrink-0 border-r border-[color:var(--ios-separator)] ${
          desktopSidebarOpen ? "lg:flex lg:flex-col" : "lg:hidden"
        }`}
      >
        {sidebarContent}
      </aside>

      {mobileSidebarOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="关闭侧栏"
            className="absolute inset-0 bg-black/20"
            onClick={() => setMobileSidebarOpen(false)}
            type="button"
          />
          <aside className="ios-glass absolute inset-y-0 left-0 flex w-[min(20rem,86vw)] flex-col border-r border-[color:var(--ios-separator)] shadow-[18px_0_45px_rgba(83,69,54,0.18)]">
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
        <header className="relative shrink-0 border-b border-[color:var(--ios-separator)] bg-[rgba(251,247,239,0.72)] px-3 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] backdrop-blur sm:px-4 sm:py-3">
          {!desktopSidebarOpen ? (
            <button
              aria-expanded={desktopSidebarOpen}
              className="absolute left-3 top-1/2 hidden size-7 -translate-y-1/2 place-items-center rounded-md text-stone-500 transition hover:bg-white/70 hover:text-stone-900 lg:grid"
              onClick={toggleSidebar}
              title="展开会话列表"
              type="button"
            >
              <Menu className="size-3.5" />
            </button>
          ) : null}
          <div
            className={`mx-auto flex max-w-5xl items-center justify-between gap-2 sm:gap-3 ${
              desktopSidebarOpen ? "" : "lg:pl-10"
            }`}
          >
            <div className="flex min-w-0 flex-1 items-start">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <button
                    aria-expanded={mobileSidebarOpen || desktopSidebarOpen}
                    className="grid size-7 shrink-0 place-items-center rounded-md text-stone-500 transition hover:bg-white/70 hover:text-stone-900 lg:hidden"
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
              className="w-[min(12.5rem,56vw)] min-w-0 shrink-0 sm:w-auto"
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
              <div className="grid min-h-[54vh] place-items-center text-center">
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
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[color:var(--ios-separator)] bg-white/55 px-3 py-1 text-xs font-medium text-stone-700">
                <ImageIcon className="size-3.5 text-[color:var(--claude-accent)]" />
                {sourceImageMessage ? "下一条将使用 image2 编辑所选图片" : "下一条将使用 image2 生成图片"}
              </div>
            ) : null}
            {webSearchAvailable && webSearchEnabledForMessage ? (
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[color:var(--ios-separator)] bg-white/55 px-3 py-1 text-xs font-medium text-stone-700">
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
              <div className="mb-3 flex items-center gap-2 text-xs text-stone-600">
                {loading ? <Loader2 className="size-3.5 animate-spin" /> : null}
                <span>{streamStatus}</span>
              </div>
            ) : null}
            {error ? (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            ) : null}
            {quotaBlocked ? (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                本月额度已用完，请联系管理员。
              </div>
            ) : null}
            {editingMessage ? (
              <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-[color:var(--ios-separator)] bg-white/60 px-3 py-2 text-xs text-stone-700">
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
              <div className="mb-2 flex max-w-full items-center gap-2 rounded-lg border border-[color:var(--ios-separator)] bg-white/65 px-2 py-2 text-xs text-stone-700">
                <img
                  alt="待编辑图片"
                  className="size-12 shrink-0 rounded-md object-cover"
                  src={sourceImageMessage.imageUrl}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-stone-900">正在编辑这张图片</div>
                  <div className="truncate ios-muted">输入修改要求后将使用 image2 编辑</div>
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
            <div className="ios-panel claude-composer flex min-h-14 flex-col gap-2 px-2 py-2 shadow-[0_16px_38px_rgba(83,69,54,0.12)] sm:flex-row sm:items-center sm:bg-white/90 sm:px-3 sm:shadow-[0_18px_70px_rgba(83,69,54,0.18)]">
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
                  className="grid size-9 shrink-0 place-items-center rounded-full border border-[color:var(--ios-separator)] bg-white/55 text-stone-600 transition hover:bg-white/80 disabled:opacity-50 sm:border-transparent sm:bg-transparent sm:hover:bg-stone-100/80"
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
                  className={`grid size-9 shrink-0 place-items-center rounded-full border transition ${
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
                  title={imageToolEnabled ? "已开启：下一条按 image2 生图" : "下一条按 image2 生图"}
                  type="button"
                >
                  <ImageIcon className="size-4" />
                </button>
                {webSearchAvailable ? (
                  <div
                    className="relative flex min-w-0 shrink-0 items-center"
                    ref={searchProviderMenuRef}
                  >
                    <button
                      aria-pressed={webSearchEnabledForMessage}
                      className={`grid size-9 place-items-center rounded-l-full border border-r-0 transition ${
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
                    <button
                      aria-expanded={searchProviderMenuOpen}
                      className={`flex h-9 min-w-0 items-center gap-1 rounded-r-full border px-2 text-[11px] font-semibold transition ${
                        webSearchEnabledForMessage
                          ? "border-[color:var(--claude-accent)] bg-[#f3d8ca] text-[color:var(--claude-accent-dark)]"
                          : "border-[color:var(--ios-separator)] bg-white/55 text-stone-600 hover:bg-white/80"
                      }`}
                      disabled={loading || quotaBlocked}
                      onClick={() => setSearchProviderMenuOpen((current) => !current)}
                      title="选择搜索引擎"
                      type="button"
                    >
                      <span className="max-w-16 truncate sm:max-w-12">{webSearchProviderLabel}</span>
                      <ChevronDown
                        className={`size-3.5 shrink-0 transition ${
                          searchProviderMenuOpen ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                    {searchProviderMenuOpen ? (
                      <div className="absolute bottom-full left-0 z-50 mb-2 w-36 rounded-lg border border-[color:var(--ios-separator)] bg-[color:var(--claude-surface)] p-1 shadow-[0_18px_45px_rgba(83,69,54,0.16)]">
                        {[
                          { id: "auto", label: "自动" },
                          { id: "bing", label: "Bing" },
                          { id: "google", label: "Google" },
                          { id: "duckduckgo", label: "DuckDuckGo" }
                        ].map((option) => (
                          <button
                            className={`flex h-9 w-full items-center justify-between gap-2 rounded-md px-2.5 text-left text-sm transition ${
                              option.id === webSearchProvider
                                ? "bg-[#f3d8ca] font-semibold text-[color:var(--claude-accent-dark)]"
                                : "text-stone-700 hover:bg-[#f6eadf]"
                            }`}
                            key={option.id}
                            onClick={() => {
                              setWebSearchProvider(option.id as WebSearchProviderOption);
                              setSearchProviderMenuOpen(false);
                            }}
                            type="button"
                          >
                            <span className="min-w-0 truncate">{option.label}</span>
                            {option.id === webSearchProvider ? (
                              <Check className="size-4 shrink-0" />
                            ) : null}
                          </button>
                        ))}
                      </div>
                    ) : null}
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
        : "输入消息，或直接说“画一张...”";
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
        className="grid size-9 shrink-0 place-items-center rounded-full bg-[color:var(--claude-accent)] text-white transition hover:bg-[color:var(--claude-accent-dark)] disabled:bg-stone-300"
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
  const mobileModelLabel = getCompactModelLabel(modelLabel);
  const activeReasoningLabel = getReasoningUiCopy(activeReasoningEffort.id).label;

  return (
    <div className="relative w-full sm:w-auto">
      <button
        aria-expanded={open}
        aria-label="选择模型和思考强度"
        className={`flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-full border px-3 text-left text-xs font-medium backdrop-blur transition sm:h-9 sm:min-w-60 sm:px-3.5 ${
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
            <span className="sm:hidden">{mobileModelLabel}</span>
            <span className="hidden sm:inline">{modelLabel}</span>
          </span>
          <span className="text-stone-300">/</span>
          <span className="shrink-0 text-stone-500 sm:hidden">{activeReasoningLabel}</span>
          <span className="hidden shrink-0 text-stone-500 sm:inline">
            思考 {activeReasoningLabel}
          </span>
        </span>
        <ChevronDown
          className={`size-3.5 shrink-0 text-stone-500 transition ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div className="fixed left-3 right-3 top-[calc(3.65rem+env(safe-area-inset-top))] z-50 max-h-[min(34rem,calc(100dvh-5.25rem))] overflow-y-auto rounded-[1.35rem] border border-[#eadfce] bg-[color:var(--claude-surface)] p-2 shadow-[0_24px_80px_rgba(83,69,54,0.18)] ring-1 ring-white/70 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[26rem]">
          <div className="flex items-center justify-between gap-3 px-2 py-1.5">
            <div>
              <p className="text-sm font-semibold text-stone-950">模型与思考</p>
              <p className="mt-0.5 text-[11px] text-stone-500">下一次回复生效</p>
            </div>
            <button
              className="grid size-8 shrink-0 place-items-center rounded-full text-stone-500 transition hover:bg-stone-100 hover:text-stone-950"
              onClick={() => onOpenChange(false)}
              title="关闭"
              type="button"
            >
              <X className="size-4" />
            </button>
          </div>

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
                    className={`group flex min-h-12 w-full min-w-0 items-center justify-between gap-3 rounded-[0.9rem] px-3 text-left text-sm transition ${
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
                    className={`min-h-12 rounded-[0.9rem] px-2.5 text-left transition ${
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

          <button
            className="mt-2 flex h-10 w-full items-center justify-center rounded-full bg-[color:var(--claude-accent)] px-3 text-sm font-semibold text-white transition hover:bg-[color:var(--claude-accent-dark)]"
            onClick={() => onOpenChange(false)}
            type="button"
          >
            完成
          </button>
        </div>
      ) : null}
    </div>
  );
}

function getCompactModelLabel(label: string) {
  return label.replace(/^GPT-/, "GPT-").replace("-Codex-Spark", "");
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
    <div className="mb-3 rounded-lg border border-[color:var(--ios-separator)] bg-white/55 px-3 py-2 text-xs text-stone-700">
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
        <div className="mt-2 border-t border-[color:var(--ios-separator)] pt-2">
          <div className="space-y-2">
            {events.map((event) => {
              const eventFinishedAt = event.finishedAt ?? (event.status === "running" ? now : event.startedAt);
              const eventElapsed = formatElapsedDuration(eventFinishedAt - event.startedAt);

              return (
                <div className="flex min-w-0 items-start gap-2" key={event.id}>
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
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${
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
    <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs leading-5 text-amber-900">
      {message}
    </div>
  );
}

function UsageBars({ usage }: { usage: UsageSummary }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-stone-800">
        <Gauge className="size-4 text-[color:var(--claude-accent)]" />
        本月费用额度
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between gap-2 text-xs ios-muted">
          <span>费用</span>
          <span>剩余 {formatCents(usage.remainingCostCents)}</span>
        </div>
        <p className="mb-1 text-[11px] ios-muted">
          已用 {formatCents(usage.costUsedCents)} / {formatCents(usage.monthlyCostLimitCents)}
        </p>
        <div className="h-2 overflow-hidden rounded-full bg-white/80">
          <div
            className="h-full rounded-full bg-[color:var(--claude-accent)]"
            style={{
              width: `${usagePercent(usage.costUsedCents, usage.monthlyCostLimitCents)}%`
            }}
          />
        </div>
        <p className="mt-2 text-[11px] leading-5 ios-muted">
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
    <div className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-[color:var(--ios-separator)] bg-white/65 px-2 py-1.5 text-xs text-stone-700">
      <span className="shrink-0 text-[color:var(--claude-accent)]">
        <AttachmentIcon attachment={attachment} />
      </span>
      <span className="min-w-0 truncate">{attachment.originalName}</span>
      <span className="shrink-0 ios-muted">{formatBytes(attachment.sizeBytes)}</span>
      {onRemove ? (
        <button
          className="grid size-5 shrink-0 place-items-center rounded-md text-stone-500 hover:bg-stone-200/60 hover:text-stone-900"
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
            className={`block overflow-hidden rounded-lg border ${
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
      className={`transition ${
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
            className="group block min-w-0 rounded-lg border border-[color:var(--ios-separator)] bg-white/55 px-3 py-2 text-xs text-stone-700 transition hover:bg-white/85"
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

const MessageBubble = memo(function MessageBubble({
  message,
  onContinue,
  onCopy,
  onDelete,
  onEdit,
  onEditImage,
  onRegenerate
}: {
  message: MessageView;
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

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
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
            className={`mt-1.5 flex flex-wrap gap-1 ${
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
