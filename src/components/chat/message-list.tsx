"use client";

import { RefObject, ReactNode } from "react";
import { ArrowUpRight, FileText, Loader2 } from "lucide-react";
import type { ChatModelView, MessageView, ToolEventView } from "@/types/gateway";
import { ChatProjectView } from "./types";
import { MessageBubble } from "./message-bubble";

type MessageListProps = {
  emptyState?: ReactNode;
  onOpenArtifact?: (key: string) => void;
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

export function MessageList({
  emptyState,
  onOpenArtifact,
  messages,
  conversationSwitching,
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
      className="chat-message-list min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4 sm:py-6"
      data-empty={messages.length === 0}
      onScroll={updateAutoScrollState}
      ref={messageScrollRef}
    >
      <div className="chat-message-stream mx-auto flex max-w-4xl flex-col gap-7">
        {!conversationSwitching && messages.length === 0 ? emptyState : null}
        {conversationSwitching && messages.length === 0 ? (
          <div className="app-empty-state grid min-h-[54vh] place-items-center text-center">
            <div className="app-status-pill app-glass-control inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-stone-700">
              <Loader2 className="size-4 animate-spin text-[color:var(--claude-accent)]" />
              加载会话中...
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
            <div key={message.id} className="min-w-0">
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
            {message.response?.artifacts?.length ? <div className="mt-3 flex flex-wrap gap-2 pl-2 sm:pl-12">
              {message.response.artifacts.map(artifact => <button key={artifact.id} type="button" onClick={() => onOpenArtifact?.(message.id + ":" + artifact.id)} className="flex max-w-full items-center gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 text-left shadow-sm hover:border-stone-400"><FileText className="size-5 shrink-0 text-stone-500" /><span className="min-w-0"><span className="block truncate text-sm font-medium">{artifact.title}</span><span className="block truncate text-xs text-stone-500">{artifact.filename}</span></span><ArrowUpRight className="size-4 shrink-0" /></button>)}
            </div> : null}
            </div>
          );
        })}
        <div ref={scrollRef} />
      </div>
    </div>
  );
}
