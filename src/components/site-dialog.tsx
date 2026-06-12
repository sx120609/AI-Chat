"use client";

import { AlertTriangle, Loader2, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type SiteConfirmDialogProps = {
  cancelLabel?: string;
  children?: ReactNode;
  confirmLabel?: string;
  description?: string;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  open: boolean;
  title: string;
  tone?: "default" | "danger";
};

export function SiteConfirmDialog({
  cancelLabel = "取消",
  children,
  confirmLabel = "确认",
  description,
  loading = false,
  onCancel,
  onConfirm,
  open,
  title,
  tone = "default"
}: SiteConfirmDialogProps) {
  const [mounted, setMounted] = useState(false);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) {
        onCancel();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    window.setTimeout(() => confirmButtonRef.current?.focus(), 0);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [loading, onCancel, open]);

  if (!mounted || !open) {
    return null;
  }

  const danger = tone === "danger";

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center px-3 pb-3 pt-[calc(0.75rem+var(--app-safe-area-top,0px))] sm:items-center sm:p-6">
      <button
        aria-label="关闭弹窗"
        className="app-backdrop-enter absolute inset-0 bg-stone-950/28 backdrop-blur-[2px]"
        disabled={loading}
        onClick={onCancel}
        type="button"
      />
      <section
        aria-modal="true"
        className="app-dialog-panel app-modal-panel relative w-full max-w-[26rem] overflow-hidden rounded-[1.25rem] border border-[color:var(--ios-separator)] bg-[color:var(--claude-surface)] p-4 text-stone-950 shadow-[0_24px_80px_rgba(83,69,54,0.2)] ring-1 ring-white/70 sm:p-5"
        role="dialog"
      >
        <div className="flex items-start gap-3">
          <span
            className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-full ${
              danger ? "bg-red-50 text-red-600" : "bg-[#f3d8ca] text-[color:var(--claude-accent-dark)]"
            }`}
          >
            <AlertTriangle className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-base font-semibold leading-6 text-stone-950">{title}</h2>
              <button
                className="app-action-button grid size-8 shrink-0 place-items-center rounded-full text-stone-500 transition hover:bg-stone-100 hover:text-stone-950 disabled:opacity-40"
                disabled={loading}
                onClick={onCancel}
                title="关闭"
                type="button"
              >
                <X className="size-4" />
              </button>
            </div>
            {description ? (
              <p className="mt-2 text-sm leading-6 text-stone-600">{description}</p>
            ) : null}
            {children ? <div className="mt-3">{children}</div> : null}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            className="ios-button-secondary app-action-button flex h-10 items-center justify-center px-4 text-sm disabled:opacity-50"
            disabled={loading}
            onClick={onCancel}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className={`app-action-button flex h-10 items-center justify-center gap-2 rounded-[var(--app-radius-control)] px-4 text-sm font-semibold text-white transition disabled:opacity-60 ${
              danger
                ? "bg-red-600 hover:bg-red-700"
                : "bg-[color:var(--claude-accent)] hover:bg-[color:var(--claude-accent-dark)]"
            }`}
            disabled={loading}
            onClick={() => void onConfirm()}
            ref={confirmButtonRef}
            type="button"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}
