"use client";

import { RefObject } from "react";
import { Loader2, Sparkles } from "lucide-react";
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
};

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
  regenerateMessageHandler
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
