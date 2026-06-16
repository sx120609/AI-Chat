import { useCallback, useEffect, useRef } from "react";
import type {
  AttachmentView,
  ChatModelView,
  ConversationSummary,
  GenerationMode,
  MessageView,
  ToolEventView
} from "@/types/gateway";
import {
  GENERATION_THINKING_STATUS,
  GENERATION_THINKING_LABEL,
  GENERATION_THINKING_DETAIL,
  COMPOSER_TEXTAREA_DESKTOP_MIN_HEIGHT,
  COMPOSER_TEXTAREA_MIN_HEIGHT,
  SseEvent,
  ToolEventUpdate
} from "./types";

export function createLocalConversationKey() {
  return `local-conversation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function parseSseBlock(block: string): SseEvent | null {
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

export function usagePercent(used: number, limit: number) {
  if (limit <= 0) {
    return 0;
  }

  return Math.min(100, Math.round((used / limit) * 100));
}

export function composerTextareaMinHeight() {
  if (typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches) {
    return COMPOSER_TEXTAREA_DESKTOP_MIN_HEIGHT;
  }

  return COMPOSER_TEXTAREA_MIN_HEIGHT;
}

export function formatElapsedDuration(milliseconds: number) {
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

export function createToolEvent(
  event: ToolEventUpdate,
  now = Date.now()
): ToolEventView {
  return {
    ...event,
    finishedAt: event.finishedAt ?? (event.status === "running" ? undefined : now),
    startedAt: event.startedAt ?? now
  };
}

export function mergeToolEvent(
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

export function emptyMessage(
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

export function isLocalMessage(message: MessageView) {
  return message.id.startsWith("local-") || message.conversationId === "local";
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function conversationGroupLabel(conversation: ConversationSummary) {
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

export function groupConversations(conversations: ConversationSummary[]) {
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

export function messageProcessStatus(message: MessageView) {
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

export function shouldShowInlineError(message: string) {
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

export function latestMessageProcess(messages: MessageView[]) {
  return [...messages]
    .reverse()
    .find(
      (message) =>
        message.role === "ASSISTANT" &&
        Boolean(message.processStartedAt) &&
        Boolean(message.toolEvents?.length)
    );
}

export function useEventCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  return useCallback((...args: Args) => callbackRef.current(...args), []);
}

export function resolveChatModelId(value: string, models: ChatModelView[]) {
  return models.find((model) => model.id === value || model.upstreamId === value)?.id ?? "";
}

export function eventStatusLabel(status: ToolEventView["status"]) {
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

export function toolEventDisplayLabel(event: ToolEventView) {
  if (event.id === "generation" && event.status === "running") {
    return GENERATION_THINKING_LABEL;
  }

  return event.label;
}

export function toolEventDisplayDetail(event: ToolEventView) {
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

export function processTimelineStatus(status: string, latestRunningEvent?: ToolEventView) {
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

const TOOL_EVENT_DISPLAY_ORDER: Record<string, number> = {
  router: 0,
  memory: 1,
  attachments: 2,
  web_search: 3,
  file_analysis: 4,
  generation: 5,
  image: 5
};

export function processTimelineSortTime(event: ToolEventView) {
  if (event.type === "router") {
    return Number.NEGATIVE_INFINITY;
  }

  if (event.type === "usage") {
    return Number.POSITIVE_INFINITY;
  }

  return event.startedAt;
}

export function sortProcessTimelineEvents(events: ToolEventView[]) {
  return events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => {
      const timeDiff = processTimelineSortTime(left.event) - processTimelineSortTime(right.event);

      if (timeDiff !== 0) {
        return timeDiff;
      }

      const leftOrder = TOOL_EVENT_DISPLAY_ORDER[left.event.type] ?? 99;
      const rightOrder = TOOL_EVENT_DISPLAY_ORDER[right.event.type] ?? 99;
      const orderDiff = leftOrder - rightOrder;

      if (orderDiff !== 0) {
        return orderDiff;
      }

      return left.index - right.index;
    })
    .map(({ event }) => event);
}
