"use client";

import { RefObject } from "react";
import { ArrowUpRight, FileText, Loader2, PenLine, Search, Sparkles } from "lucide-react";
import type { ChatModelView, MessageView, ToolEventView } from "@/types/gateway";
import { ChatProjectView } from "./types";
import { MessageBubble } from "./message-bubble";

type MessageListProps = {
  messages: MessageView[];
  conversationSwitching: boolean;
  activeProject: ChatProjectView | null;
  activeModel: ChatModelView | undefined;
  model: string;
  imageToolEnabled: boolean;
  inlineProcessMessageId: string | null;
  toolEvents: ToolEventView[];
  processTimelineExpanded: boolean;
  setProcessTimelineExpanded: (value: boolean) => void;
  processFinishedAt: number | null;
  processStartedAt: number | null;
  processNow: number;
  streamStatus: string;
  messageModelLabels: ReadonlyMap<string, string>;
  scrollRef: RefObject<HTMLDivElement | null>;
  messageScrollRef: RefObject<HTMLDivElement | null>;
  updateAutoScrollState: () => void;
  continueGeneratingHandler: () => void;
  copyMessageHandler: (message: MessageView) => void;
  deleteMessageHandler: (message: MessageView) => void;
  editMessageHandler: (message: MessageView) => void;
  editImageHandler: (message: MessageView) => void;
  regenerateMessageHandler: (message: MessageView) => void;
  experience?: "classic" | "beta";
  onPromptSelect?: (prompt: string) => void;
};

const betaPrompts = [
  {
    description: "把模糊问题拆成清晰、可执行的下一步",
    icon: Sparkles,
    label: "梳理方案",
    prompt: "帮我把一个复杂问题拆成清晰、可执行的下一步"
  },
  {
    description: "提炼重点、关键结论与行动事项",
    icon: FileText,
    label: "分析文件",
    prompt: "请总结这份资料，并提炼关键结论与待办事项"
  },
  {
    description: "快速建立事实框架与研究路径",
    icon: Search,
    label: "联网研究",
    prompt: "围绕这个主题做一份结构化研究，列出关键事实与来源"
  },
  {
    description: "从目标出发，起草有说服力的内容",
    icon: PenLine,
    label: "内容创作",
    prompt: "根据我的目标，起草一份专业、简洁且有说服力的内容"
  }
] as const;

export function MessageList({
  messages,
  conversationSwitching,
  activeProject,
  activeModel,
  model,
  imageToolEnabled,
  inlineProcessMessageId,
  toolEvents,
  processTimelineExpanded,
  setProcessTimelineExpanded,
  processFinishedAt,
  processStartedAt,
  processNow,
  streamStatus,
  messageModelLabels,
  scrollRef,
  messageScrollRef,
  updateAutoScrollState,
  continueGeneratingHandler,
  copyMessageHandler,
  deleteMessageHandler,
  editMessageHandler,
  editImageHandler,
  regenerateMessageHandler,
  experience = "classic",
  onPromptSelect
}: MessageListProps) {
  const fallbackProcessStartedAt = toolEvents.reduce<number | null>((earliest, event) => {
    if (!Number.isFinite(event.startedAt) || event.startedAt <= 0) {
      return earliest;
    }

    return earliest === null ? event.startedAt : Math.min(earliest, event.startedAt);
  }, null);
  const timelineStartedAt = processStartedAt ?? fallbackProcessStartedAt;

  return (
    <div
      className="chat-message-list min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4 sm:py-6"
      onScroll={updateAutoScrollState}
      ref={messageScrollRef}
    >
      <div className="chat-message-stream mx-auto flex max-w-4xl flex-col gap-7">
        {conversationSwitching && messages.length === 0 ? (
          <div className="app-empty-state grid min-h-[54vh] place-items-center text-center">
            <div className="app-status-pill app-glass-control inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-stone-700">
              <Loader2 className="size-4 animate-spin text-[color:var(--claude-accent)]" />
              加载会话中...
            </div>
          </div>
        ) : messages.length === 0 && experience === "beta" ? (
          <div className="beta-empty-state app-empty-state flex min-h-[58vh] items-center justify-center py-8">
            <div className="w-full max-w-3xl">
              <div className="beta-empty-kicker">
                <span className="beta-empty-kicker-dot" />
                AI WORKSPACE
              </div>
              <h1 className="beta-empty-title">把复杂问题，变成下一步。</h1>
              <p className="beta-empty-copy">
                写作、分析、搜索与图像，都在同一个工作台。
              </p>
              <div className="beta-prompt-grid">
                {betaPrompts.map((item) => {
                  const Icon = item.icon;

                  return (
                    <button
                      className="beta-prompt-card group"
                      key={item.label}
                      onClick={() => onPromptSelect?.(item.prompt)}
                      type="button"
                    >
                      <span className="beta-prompt-icon">
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1 text-left">
                        <span className="beta-prompt-label">{item.label}</span>
                        <span className="beta-prompt-description">{item.description}</span>
                      </span>
                      <ArrowUpRight className="beta-prompt-arrow size-4" />
                    </button>
                  );
                })}
              </div>
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
            message.id === inlineProcessMessageId &&
            inlineProcessMessageId &&
            toolEvents.length > 0 &&
            timelineStartedAt
              ? {
                  events: toolEvents,
                  expanded: processTimelineExpanded,
                  finishedAt: processFinishedAt,
                  now: processNow,
                  onExpandedChange: setProcessTimelineExpanded,
                  startedAt: timelineStartedAt,
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
  );
}
