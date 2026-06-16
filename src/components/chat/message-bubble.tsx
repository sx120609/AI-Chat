"use client";

import { Children, type ReactElement, type ReactNode, isValidElement, memo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  File as FileIcon,
  FileArchive,
  FileText,
  Image as ImageIcon,
  Loader2,
  Pencil,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Table2,
  Trash2,
  UserRound,
  X
} from "lucide-react";
import type { AttachmentView, MessageView, ToolEventView } from "@/types/gateway";
import { sanitizeIdentityLeak, sanitizeReasoningContent } from "@/lib/identity";
import { prepareMarkdownForRendering } from "@/lib/markdown";
import { formatCents, formatNumber } from "@/lib/format";
import { InlineProcessView } from "./types";
import {
  eventStatusLabel,
  formatBytes,
  formatElapsedDuration,
  processTimelineStatus,
  sortProcessTimelineEvents,
  toolEventDisplayDetail,
  toolEventDisplayLabel
} from "./utils";

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

  return <Sparkles className="size-3.5" />;
}

export function ProcessTimelinePanel({
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
  const safeElapsed = (endedAt: number, startedAt: number) =>
    Number.isFinite(endedAt) &&
    Number.isFinite(startedAt) &&
    startedAt > 0 &&
    endedAt >= startedAt
      ? endedAt - startedAt
      : 0;
  const elapsed = formatElapsedDuration(safeElapsed(finishedAt ?? now, startedAt));
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
          <span className="min-w-0 truncate ios-muted">{displayStatus}</span>
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
              const eventElapsed = formatElapsedDuration(safeElapsed(eventFinishedAt, event.startedAt));
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

export function AttachmentChip({
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

type MessageBubbleProps = {
  inlineProcess?: InlineProcessView | null;
  message: MessageView;
  modelLabelById: ReadonlyMap<string, string>;
  onContinue: () => void;
  onCopy: (message: MessageView) => void | Promise<void>;
  onDelete: (message: MessageView) => void | Promise<void>;
  onEdit: (message: MessageView) => void;
  onEditImage: (message: MessageView) => void;
  onRegenerate: (message: MessageView) => void | Promise<void>;
};

export const MessageBubble = memo(function MessageBubble({
  inlineProcess,
  message,
  modelLabelById,
  onContinue,
  onCopy,
  onDelete,
  onEdit,
  onEditImage,
  onRegenerate
}: MessageBubbleProps) {
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
            <p className="mt-2 text-xs opacity-70">思考中，正在组织回答...</p>
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
MessageBubble.displayName = "MessageBubble";
