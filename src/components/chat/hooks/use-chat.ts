"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type {
  AttachmentView,
  ChatModelView,
  ConversationSummary,
  MessageView,
  ReasoningEffort,
  SiteSettingsView,
  UsageSummary,
  UserView,
  PublicPaymentSettingsView,
  ToolEventView
} from "@/types/gateway";
import { DEFAULT_IMAGE_SIZE, supportsMaxReasoning } from "@/lib/models";
import { parsePersonalizationSettings } from "@/lib/personalization";
import { formatPromptClock } from "@/lib/system-prompt";
import { sanitizeIdentityLeak } from "@/lib/identity";
import {
  ChatShellProps,
  ComposerDraftState,
  ContextStats,
  InFlightChatGeneration,
  ShareNotice,
  ChatProjectView,
  GENERATION_STREAMING_DETAIL,
  GENERATION_STREAMING_STATUS,
  GENERATION_THINKING_DETAIL,
  GENERATION_THINKING_LABEL,
  GENERATION_THINKING_STATUS,
  STREAM_RENDER_INTERVAL_MS,
  SseEvent
} from "../types";
import {
  createLocalConversationKey,
  createToolEvent,
  emptyMessage,
  isLocalMessage,
  latestMessageProcess,
  mergeToolEvent,
  messageProcessStatus,
  parseSseBlock,
  resolveChatModelId,
  useEventCallback
} from "../utils";

export function useChat({
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

  const [user] = useState<UserView>(initialUser);
  const [siteSettings, setSiteSettings] = useState<SiteSettingsView>(initialSiteSettings);
  const [usage, setUsage] = useState<UsageSummary>(initialUsage);
  const [paymentSettings, setPaymentSettings] = useState<PublicPaymentSettingsView>(initialPaymentSettings);
  const [chatModels, setChatModels] = useState<ChatModelView[]>(initialModels);
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
  const [imageSize, setImageSize] = useState<string>(DEFAULT_IMAGE_SIZE);
  const [sourceImageMessage, setSourceImageMessage] = useState<MessageView | null>(null);
  const [webSearchAvailable, setWebSearchAvailable] = useState(initialWebSearchEnabled);
  const [webSearchEnabledForMessage, setWebSearchEnabledForMessage] = useState(
    initialWebSearchEnabled &&
      personalizationSettings.toolPreferences.webSearchDefault &&
      !securityModeDefault
  );
  const [temporaryChatEnabled, setTemporaryChatEnabled] = useState(defaultTemporaryMode);
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
    personalizationSettings.toolPreferences.fileAnalysisEnabled &&
    !securityModeDefault;
  const webSearchToolAvailable = webSearchAvailable && !securityModeDefault;
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
    () => REASONING_EFFORTS_ARRAY.find((item) => item.id === reasoningEffort) ?? REASONING_EFFORTS_ARRAY[0],
    [reasoningEffort]
  );

  useEffect(() => {
    if (reasoningEffort === "max" && activeModel && !supportsMaxReasoning(activeModel)) {
      setReasoningEffort("xhigh");
    }
  }, [activeModel, reasoningEffort]);
  const webSearchProvider = "duckduckgo";
  const webSearchProviderLabel = "DuckDuckGo";
  const inlineProcessMessageId = useMemo(() => {
    if (!processStartedAt || !processMessageId) {
      return null;
    }

    return messages.some((message) => message.id === processMessageId) ? processMessageId : null;
  }, [messages, processMessageId, processStartedAt]);

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
          (current) => current || payload.defaultReasoningEffort || "medium"
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
    autoScrollRef.current = distanceFromBottom <= 96; // 96px AUTO_SCROLL_BOTTOM_THRESHOLD_PX
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

  function isFileDrag(event: React.DragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  function resetFileDragState() {
    fileDragDepthRef.current = 0;
    setDraggingFiles(false);
  }

  function handleFileDragEnter(event: React.DragEvent<HTMLElement>) {
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

  function handleFileDragOver(event: React.DragEvent<HTMLElement>) {
    if (!isFileDrag(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect =
      loading || quotaBlocked || uploadingAttachments || conversationSwitching ? "none" : "copy";
  }

  function handleFileDragLeave(event: React.DragEvent<HTMLElement>) {
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

  function handleFileDrop(event: React.DragEvent<HTMLElement>) {
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
      setError("额度不足，请充值 AI 点数或联系管理员。");
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
      imageSize?: string;
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
    const startingConversationId = reuseUserMessage?.conversationId ?? activeConversationIdRef.current;
    const requestDisableMemoryWrite = options.disableMemoryWrite ?? requestTemporary;
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
          imageSize: options.imageSize ?? imageSize,
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
    const upsertToolEvent = (toolEvent: Omit<ToolEventView, "finishedAt" | "startedAt"> & Partial<Pick<ToolEventView, "finishedAt" | "startedAt">>) => {
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
              detail: "已更新额度和费用",
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
          size: imageSize,
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
      const requestDisableMemoryWrite = requestTemporary;

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
        imageSize,
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

  return {
    user,
    siteSettings,
    usage,
    paymentSettings,
    chatModels,
    projects,
    activeProjectId,
    conversations,
    activeConversationId,
    activeLocalConversationKey,
    conversationSearch,
    renamingConversationId,
    renamingTitle,
    openConversationMenuId,
    deleteConversationTarget,
    deletingConversationId,
    deleteMessageTarget,
    deletingMessageId,
    sharingConversationId,
    shareNotice,
    loadingConversationId,
    messages,
    imageToolEnabled,
    imageSize,
    sourceImageMessage,
    webSearchAvailable,
    webSearchEnabledForMessage,
    temporaryChatEnabled,
    model,
    reasoningEffort,
    composerDraft,
    pendingAttachments,
    editingMessage,
    error,
    paymentDialogOpen,
    draggingFiles,
    runningGenerationKeys,
    uploadingAttachments,
    modelPickerOpen,
    mobileSidebarOpen,
    desktopSidebarOpen,
    streamStatus,
    toolEvents,
    processTimelineExpanded,
    processMessageId,
    processStartedAt,
    processFinishedAt,
    processNow,
    lastContextStats,
    securityModeDefault,

    // Refs
    fileInputRef,
    headerControlsRef,
    messageScrollRef,
    scrollRef,

    // Derived State
    quotaBlocked,
    imageGenerationAvailable,
    fileAnalysisAvailable,
    webSearchToolAvailable,
    runningGenerationKeySet,
    loading,
    conversationSwitching,
    activeConversation,
    activeProject,
    activeModel,
    messageModelLabels,
    activeReasoningEffort,
    webSearchProviderLabel,
    inlineProcessMessageId,
    deleteMessagePreview,

    // Actions
    setPaymentDialogOpen,
    setConversationSearch,
    setRenamingTitle,
    setOpenConversationMenuId,
    setDeleteConversationTarget,
    setDeleteMessageTarget,
    setShareNotice,
    setWebSearchEnabledForMessage,
    setImageToolEnabled,
    setImageSize,
    setTemporaryChatEnabled,
    setModel,
    setReasoningEffort,
    setModelPickerOpen,
    setMobileSidebarOpen,
    setDesktopSidebarOpen,
    setProcessTimelineExpanded,
    setError,
    setSourceImageMessage,

    // Functions
    logout,
    startNewConversation,
    changeActiveProject,
    beginRenameConversation,
    cancelRenameConversation,
    submitRenameConversation,
    togglePinConversation,
    shareConversation,
    copyShareNoticeUrl,
    requestDeleteConversation,
    deleteConversation,
    openConversation,
    toggleSidebar,
    uploadAttachments,
    removePendingAttachment,
    handleFileDragEnter,
    handleFileDragLeave,
    handleFileDragOver,
    handleFileDrop,
    cancelEditMessage,
    updateAutoScrollState,

    // Event Handlers
    copyMessageHandler,
    deleteMessageHandler,
    confirmDeleteMessageHandler,
    editMessageHandler,
    editImageHandler,
    regenerateMessageHandler,
    continueGeneratingHandler,
    sendHandler,
    stopGenerationHandler
  };
}

// Private constant for reasoning array since REASONING_EFFORTS in models.ts is just type definition and array export
const REASONING_EFFORTS_ARRAY = [
  { id: "low" as const, name: "low" },
  { id: "medium" as const, name: "medium" },
  { id: "high" as const, name: "high" },
  { id: "xhigh" as const, name: "xhigh" },
  { id: "max" as const, name: "max" }
];
