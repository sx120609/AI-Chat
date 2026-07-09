"use client";

import { KeyboardEvent, memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Send, Square, X } from "lucide-react";
import {
  COMPOSER_FULLSCREEN_THRESHOLD,
  COMPOSER_TEXTAREA_MAX_HEIGHT
} from "./types";
import { composerTextareaMinHeight } from "./utils";

type ComposerInputAreaProps = {
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
};

export const ComposerInputArea = memo(function ComposerInputArea({
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
}: ComposerInputAreaProps) {
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
            aria-label="消息输入"
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
                  aria-label="全屏消息输入"
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
ComposerInputArea.displayName = "ComposerInputArea";
