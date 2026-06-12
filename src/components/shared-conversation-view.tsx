"use client";

import {
  ExternalLink,
  File as FileIcon,
  FileArchive,
  FileText,
  Image as ImageIcon,
  Sparkles,
  Table2,
  UserRound
} from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type {
  AttachmentKind,
  AttachmentView,
  SharedConversationView,
  SharedMessageView,
  WebSearchSource
} from "@/types/gateway";

function formatDateTime(value: string) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function attachmentIcon(kind: AttachmentKind) {
  if (kind === "IMAGE") {
    return <ImageIcon className="size-3.5" />;
  }

  if (kind === "SPREADSHEET") {
    return <Table2 className="size-3.5" />;
  }

  if (kind === "ARCHIVE") {
    return <FileArchive className="size-3.5" />;
  }

  if (kind === "TEXT" || kind === "DOCUMENT") {
    return <FileText className="size-3.5" />;
  }

  return <FileIcon className="size-3.5" />;
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

function SharedAttachmentChip({ attachment }: { attachment: AttachmentView }) {
  if (attachment.kind === "IMAGE" && attachment.previewUrl) {
    return (
      <a
        className="block overflow-hidden rounded-lg border border-[color:var(--ios-separator)] bg-white/65"
        href={attachment.previewUrl}
        target="_blank"
      >
        <img
          alt={attachment.originalName}
          className="size-24 object-cover"
          src={attachment.previewUrl}
        />
      </a>
    );
  }

  return (
    <div className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-[color:var(--ios-separator)] bg-white/65 px-2.5 py-1.5 text-xs text-stone-700">
      <span className="grid size-5 shrink-0 place-items-center rounded-md bg-[#f3e5d8] text-[color:var(--claude-accent)]">
        {attachmentIcon(attachment.kind)}
      </span>
      <span className="min-w-0 truncate">{attachment.originalName}</span>
      <span className="shrink-0 text-stone-400">{formatBytes(attachment.sizeBytes)}</span>
    </div>
  );
}

function SharedAttachments({ attachments }: { attachments?: AttachmentView[] }) {
  if (!attachments?.length) {
    return null;
  }

  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {attachments.map((attachment) => (
        <SharedAttachmentChip attachment={attachment} key={attachment.id} />
      ))}
    </div>
  );
}

function SharedSources({ sources }: { sources?: WebSearchSource[] }) {
  if (!sources?.length) {
    return null;
  }

  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {sources.map((source, index) => (
        <a
          className="block min-w-0 rounded-lg border border-[color:var(--ios-separator)] bg-white/55 px-3 py-2 text-xs text-stone-700 transition hover:bg-white/85"
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
            <ExternalLink className="size-3 shrink-0" />
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
  );
}

const markdownComponents: Components = {
  pre({ children }) {
    return (
      <pre className="overflow-x-auto rounded-lg bg-[#302d27] p-3 text-xs leading-5 text-[#f8f4eb]">
        {children}
      </pre>
    );
  }
};

function messageModel(message: SharedMessageView, fallbackModel: string) {
  if (message.mode === "IMAGE" || message.model === "image2") {
    return "image2";
  }

  return message.model || fallbackModel || "AI";
}

function SharedMessage({
  conversationModel,
  message
}: {
  conversationModel: string;
  message: SharedMessageView;
}) {
  const isUser = message.role === "USER";
  const label = isUser ? "用户" : `AI · ${messageModel(message, conversationModel)}`;

  return (
    <article className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={isUser ? "max-w-[min(680px,88%)]" : "w-full max-w-[760px]"}>
        <div
          className={
            isUser
              ? "rounded-2xl bg-[color:var(--claude-accent)] px-4 py-3 text-white shadow-sm"
              : "px-1 py-1 text-stone-900"
          }
        >
          <div
            className={`mb-2 flex min-w-0 items-center gap-1.5 text-xs font-semibold ${
              isUser ? "text-white/75" : "text-stone-500"
            }`}
          >
            {isUser ? (
              <UserRound className="size-3.5 shrink-0" />
            ) : (
              <Sparkles className="size-3.5 shrink-0 text-[color:var(--claude-accent)]" />
            )}
            <span className="min-w-0 truncate">{label}</span>
            <span className="shrink-0 opacity-70">· {formatDateTime(message.createdAt)}</span>
          </div>
          <SharedAttachments attachments={message.attachments} />
          {message.imageUrl ? (
            <img
              alt={message.content || "生成图片"}
              className="aspect-square w-full max-w-lg rounded-md object-cover"
              src={message.imageUrl}
            />
          ) : isUser ? (
            <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.content}</p>
          ) : (
            <div className="claude-markdown text-sm leading-6">
              <ReactMarkdown
                components={markdownComponents}
                rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
                remarkPlugins={[remarkGfm, remarkMath]}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          )}
          {!isUser ? <SharedSources sources={message.webSources} /> : null}
        </div>
      </div>
    </article>
  );
}

export function SharedConversationView({
  conversation,
  siteName
}: {
  conversation: SharedConversationView;
  siteName: string;
}) {
  return (
    <main className="h-dvh overflow-y-auto bg-[color:var(--background)] text-[color:var(--foreground)]">
      <header className="sticky top-0 z-20 border-b border-[color:var(--ios-separator)] bg-[rgba(251,247,239,0.82)] px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[color:var(--claude-accent)]">{siteName}</p>
            <h1 className="truncate text-lg font-semibold text-stone-950">{conversation.title}</h1>
          </div>
          <div className="hidden shrink-0 text-right text-xs text-stone-500 sm:block">
            <div>{conversation.mode === "IMAGE" ? "image2" : conversation.model}</div>
            <div>分享于 {formatDateTime(conversation.sharedAt)}</div>
          </div>
        </div>
      </header>
      <section className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-4xl flex-col gap-6 px-4 py-6">
        {conversation.messages.length ? (
          conversation.messages.map((message) => (
            <SharedMessage
              conversationModel={conversation.model}
              key={message.id}
              message={message}
            />
          ))
        ) : (
          <div className="rounded-lg border border-[color:var(--ios-separator)] bg-white/55 p-6 text-center text-sm text-stone-500">
            这条分享里暂时没有可显示的消息。
          </div>
        )}
      </section>
    </main>
  );
}
