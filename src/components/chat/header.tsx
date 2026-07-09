"use client";

import { RefObject, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  Clock3,
  FolderOpen,
  Menu,
  MessageSquarePlus,
  Sparkles,
  X,
  Check
} from "lucide-react";
import type { ChatModelView, ConversationSummary, ReasoningEffort, UsageSummary } from "@/types/gateway";
import { formatCents, formatNumber, formatShortDateTime } from "@/lib/format";
import { supportsMaxReasoning } from "@/lib/models";
import { ChatProjectView, ContextStats } from "./types";

function getModelPickerDetail(model: ChatModelView) {
  const role =
    model.source === "upstream"
      ? "上游模型"
      : model.contextNote === "低成本"
        ? "轻量快速"
        : model.contextNote === "代码" || model.contextNote === "轻量代码"
          ? "轻量代码"
          : model.contextNote || "通用";

  return `${role} · ${formatModelContext(model)} 上下文`;
}

function getReasoningUiCopy(id: ReasoningEffort) {
  if (id === "low") {
    return { label: "快", hint: "日常" };
  }

  if (id === "high") {
    return { label: "深", hint: "复杂" };
  }

  if (id === "xhigh") {
    return { label: "最强", hint: "难题" };
  }

  if (id === "max") {
    return { label: "Max", hint: "极限" };
  }

  return { label: "均衡", hint: "默认" };
}

function commonContextTokensForModel(model: ChatModelView | undefined, fallbackTokens: number) {
  const signature = `${model?.id || ""} ${model?.label || ""} ${model?.upstreamId || ""}`.toLowerCase();

  if (signature.includes("spark") || signature.includes("gpt-5.3")) {
    return 400_000;
  }

  if (signature.includes("gpt-5.6") || signature.includes("gpt-5.5") || signature.includes("gpt-5.4")) {
    return 1_000_000;
  }

  return fallbackTokens >= 1_000_000_000 ? 1_000_000 : fallbackTokens;
}

function formatCompactContext(tokens: number) {
  if (tokens >= 1_000_000_000) {
    return "1M";
  }

  if (tokens >= 1_000_000) {
    const value = tokens / 1_000_000;
    return Number.isInteger(value) ? `${value}M` : `${value.toFixed(1)}M`;
  }

  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}K`;
  }

  return formatNumber(tokens);
}

function formatModelContext(model: ChatModelView | undefined, fallbackTokens = model?.contextWindowTokens ?? 1_000_000) {
  return formatCompactContext(commonContextTokensForModel(model, fallbackTokens));
}

const REASONING_EFFORTS_ARRAY = [
  { id: "low" as const, name: "low" },
  { id: "medium" as const, name: "medium" },
  { id: "high" as const, name: "high" },
  { id: "xhigh" as const, name: "xhigh" },
  { id: "max" as const, name: "max" }
];

function reasoningOptionsForModel(model: ChatModelView | undefined) {
  return REASONING_EFFORTS_ARRAY.filter((item) => item.id !== "max" || supportsMaxReasoning(model));
}

const chatHeaderIconButtonClass =
  "app-action-button app-chat-header-button grid size-10 shrink-0 place-items-center rounded-full text-[color:var(--app-ink-soft)] transition active:scale-95 disabled:opacity-70";
const chatHeaderPillButtonClass =
  "app-action-button app-chat-header-button inline-flex h-10 min-w-0 items-center rounded-full text-[color:var(--app-ink-soft)] transition active:scale-95 disabled:opacity-70";

export function ContextBadge({
  compact = false,
  contextStats,
  model,
  contextWindowTokens
}: {
  compact?: boolean;
  contextStats: ContextStats | null;
  model?: ChatModelView;
  contextWindowTokens: number;
}) {
  const usedTokens = contextStats?.promptTokensEstimate ?? 0;
  const contextLabel = formatModelContext(model, contextWindowTokens);

  return (
    <span
      className={`app-status-pill app-chat-header-button inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full text-stone-600 ${
        compact ? "h-10 px-3 text-sm font-semibold" : "px-2.5 py-1 text-[11px]"
      }`}
      title="后端会保留完整会话历史；此处只显示当前请求体估算，最终计费以上游 usage 为准。"
    >
      {compact ? (
        <>
          <span className="shrink-0">上下文</span>
          <span className="min-w-0 truncate">{contextLabel}</span>
        </>
      ) : (
        <>
          <span className="shrink-0">上下文</span>
          {contextStats ? (
            <span className="min-w-0 truncate">已用约 {formatNumber(usedTokens)} · {contextLabel}</span>
          ) : (
            <span className="min-w-0 truncate">{contextLabel}</span>
          )}
        </>
      )}
    </span>
  );
}

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
  activeReasoningEffort: (typeof REASONING_EFFORTS_ARRAY)[number];
  models: ChatModelView[];
  modelValue: string;
  onModelChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onReasoningChange: (value: ReasoningEffort) => void;
  open: boolean;
  reasoningValue: ReasoningEffort;
}) {
  const reasoningSupported = activeModel?.supportsReasoning ?? true;
  const reasoningOptions = reasoningOptionsForModel(activeModel);
  const effectiveReasoningValue = reasoningOptions.some((item) => item.id === reasoningValue)
    ? reasoningValue
    : activeReasoningEffort.id;
  const modelLabel = activeModel?.label || modelValue || "选择模型";
  const activeReasoningLabel = getReasoningUiCopy(activeReasoningEffort.id).label;
  const [portalReady, setPortalReady] = useState(false);
  const [useMobilePortal, setUseMobilePortal] = useState(false);

  useEffect(() => {
    setPortalReady(true);

    const mediaQuery = window.matchMedia("(max-width: 639px)");
    const syncPortalMode = () => setUseMobilePortal(mediaQuery.matches);
    syncPortalMode();
    mediaQuery.addEventListener("change", syncPortalMode);

    return () => mediaQuery.removeEventListener("change", syncPortalMode);
  }, []);

  const pickerPanel = open ? (
    <>
      <button
        aria-label="关闭模型选择"
        className="app-backdrop-enter fixed inset-0 z-40 bg-black/10 sm:hidden"
        onClick={() => onOpenChange(false)}
        type="button"
      />
      <div
        className="app-popover-enter app-glass-panel fixed bottom-2 left-2 right-2 z-50 flex max-h-[calc(100dvh_-_1rem)] min-h-0 flex-col overflow-hidden rounded-[1.35rem] p-2.5 ring-1 ring-white/70 sm:absolute sm:bottom-auto sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:max-h-[34rem] sm:w-[26rem] sm:rounded-[1.25rem] sm:p-2"
        data-model-picker-panel
      >
        <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-stone-300/70 sm:hidden" />
        <div className="flex items-center justify-between gap-3 px-2 py-1.5">
          <div>
            <p className="text-sm font-semibold text-stone-950">模型与思考</p>
            <p className="mt-0.5 text-[11px] text-stone-500">下一次回复生效</p>
          </div>
          <button
            className="app-action-button app-glass-control grid size-8 shrink-0 place-items-center rounded-full text-stone-500 transition hover:text-stone-950"
            onClick={() => onOpenChange(false)}
            title="关闭"
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pb-1 pr-1">
          <div className="mt-2 rounded-[1.05rem] border border-white/45 bg-white/58 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.62)] backdrop-blur-xl">
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
                    className={`app-list-row group flex min-h-12 w-full min-w-0 items-center justify-between gap-3 rounded-[0.9rem] px-3 py-2 text-left text-sm transition sm:py-0 ${
                      selected
                        ? "bg-white/82 text-stone-950 shadow-[0_10px_26px_rgba(18,42,35,0.1)] ring-1 ring-[color:var(--app-accent-ring)] backdrop-blur-xl"
                        : "text-stone-700 hover:bg-white/62 hover:text-stone-950"
                    }`}
                    key={item.id}
                    onClick={() => {
                      onModelChange(item.id);

                      if (reasoningValue === "max" && !supportsMaxReasoning(item)) {
                        onReasoningChange("xhigh");
                      }
                    }}
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
                      <span className="size-4 shrink-0 rounded-full border border-[color:var(--app-border-strong)] opacity-0 transition group-hover:opacity-100" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-2 rounded-[1.05rem] border border-white/45 bg-white/58 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.62)] backdrop-blur-xl">
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-[11px] font-semibold text-stone-500">思考强度</span>
              {!reasoningSupported ? (
                <span className="text-[11px] text-stone-500">可能不会生效</span>
              ) : null}
            </div>
            <div className={`grid gap-1 ${reasoningOptions.length === 5 ? "grid-cols-5" : "grid-cols-4"}`}>
              {reasoningOptions.map((item) => {
                const selected = item.id === effectiveReasoningValue;
                const copy = getReasoningUiCopy(item.id);

                return (
                  <button
                    className={`app-list-row min-h-12 rounded-[0.9rem] px-1.5 text-center transition sm:px-2.5 sm:text-left ${
                      selected
                        ? "bg-white/82 text-stone-950 shadow-[0_10px_26px_rgba(18,42,35,0.1)] ring-1 ring-[color:var(--app-accent-ring)] backdrop-blur-xl"
                        : "text-stone-600 hover:bg-white/62 hover:text-stone-950"
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
        </div>

        <button
          className="app-action-button app-glass-primary mt-2 flex h-10 w-full shrink-0 items-center justify-center rounded-full px-3 text-sm font-semibold transition"
          onClick={() => onOpenChange(false)}
          type="button"
        >
          完成
        </button>
      </div>
    </>
  ) : null;

  return (
    <div className="relative w-full sm:w-auto">
      <button
        aria-expanded={open}
        aria-label="选择模型和思考强度"
        className={`${chatHeaderPillButtonClass} w-full justify-between gap-2 px-3 text-left text-[15px] font-semibold sm:h-9 sm:min-w-60 sm:px-3.5 sm:text-xs sm:font-medium ${
          open ? "app-chat-header-button-active text-stone-950" : "text-stone-800"
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
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[color:var(--app-accent-soft)] text-[color:var(--claude-accent-dark)]">
            <Sparkles className="size-3" />
          </span>
          <span className="min-w-0 truncate text-stone-950">
            <span className="sm:hidden">{modelLabel}</span>
            <span className="hidden sm:inline">{modelLabel}</span>
          </span>
          <span className="hidden text-stone-300 sm:inline">/</span>
          <span className="hidden shrink-0 text-stone-500 sm:inline">
            思考 {activeReasoningLabel}
          </span>
        </span>
        <ChevronDown
          className={`size-3.5 shrink-0 text-stone-500 transition ${open ? "rotate-180" : ""}`}
        />
      </button>

      {pickerPanel && useMobilePortal && portalReady
        ? createPortal(pickerPanel, document.body)
        : pickerPanel}
    </div>
  );
}

type HeaderProps = {
  desktopSidebarOpen: boolean;
  mobileSidebarOpen: boolean;
  toggleSidebar: () => void;
  headerControlsRef: RefObject<HTMLDivElement | null>;
  activeModel: ChatModelView | undefined;
  lastContextStats: ContextStats | null;
  activeConversation: ConversationSummary | undefined;
  activeProject: ChatProjectView | null;
  projects: ChatProjectView[];
  activeProjectId: string;
  changeActiveProject: (projectId: string) => Promise<void>;
  usage: UsageSummary;
  temporaryChatEnabled: boolean;
  securityModeDefault: boolean;
  loading: boolean;
  conversationSwitching: boolean;
  quotaBlocked: boolean;
  setTemporaryChatEnabled: (value: boolean) => void;
  chatModels: ChatModelView[];
  model: string;
  setModel: (value: string) => void;
  reasoningEffort: ReasoningEffort;
  setReasoningEffort: (value: ReasoningEffort) => void;
  modelPickerOpen: boolean;
  setModelPickerOpen: (value: boolean) => void;
  startNewConversation: () => void;
};

export function Header({
  desktopSidebarOpen,
  mobileSidebarOpen,
  toggleSidebar,
  headerControlsRef,
  activeModel,
  lastContextStats,
  activeConversation,
  activeProject,
  projects,
  activeProjectId,
  changeActiveProject,
  usage,
  temporaryChatEnabled,
  securityModeDefault,
  loading,
  conversationSwitching,
  quotaBlocked,
  setTemporaryChatEnabled,
  chatModels,
  model,
  setModel,
  reasoningEffort,
  setReasoningEffort,
  modelPickerOpen,
  setModelPickerOpen,
  startNewConversation
}: HeaderProps) {
  const reasoningOptions = reasoningOptionsForModel(activeModel);
  const activeReasoningEffort =
    reasoningOptions.find((item) => item.id === reasoningEffort) ??
    reasoningOptions.find((item) => item.id === "xhigh") ??
    reasoningOptions[0] ??
    REASONING_EFFORTS_ARRAY[0];

  return (
    <header className="app-header-enter app-chat-header-shell relative z-30 shrink-0 px-3 pb-2 pt-[calc(0.5rem+var(--app-safe-area-top,0px))] sm:px-4 sm:py-3">
      {!desktopSidebarOpen ? (
        <button
          aria-expanded={desktopSidebarOpen}
          className="app-action-button app-glass-control absolute left-3 top-1/2 hidden size-8 -translate-y-1/2 place-items-center rounded-xl text-stone-500 transition hover:text-stone-900 lg:grid"
          onClick={toggleSidebar}
          title="展开会话列表"
          type="button"
        >
          <Menu className="size-3.5" />
        </button>
      ) : null}
      <div
        className={`mx-auto max-w-5xl ${desktopSidebarOpen ? "" : "lg:pl-10"}`}
        ref={headerControlsRef}
      >
        <div className="grid grid-cols-[2.5rem_auto_minmax(0,1fr)_2.5rem] items-center gap-3 lg:flex lg:items-center lg:justify-between">
          <button
            aria-expanded={mobileSidebarOpen || desktopSidebarOpen}
            className={`${chatHeaderIconButtonClass} lg:hidden`}
            onClick={toggleSidebar}
            title="切换会话列表"
            type="button"
          >
            <Menu className="size-5" />
          </button>

          {activeModel ? (
            <div className="min-w-[5.35rem] justify-self-start lg:hidden">
              <ContextBadge
                compact
                contextStats={lastContextStats}
                model={activeModel}
                contextWindowTokens={activeModel.contextWindowTokens}
              />
            </div>
          ) : null}

          <div className="hidden min-w-0 flex-1 lg:block">
            <div className="flex min-w-0 items-center gap-1.5">
              <p className="truncate text-sm font-semibold text-stone-950">
                {activeConversation?.title || "新聊天"}
              </p>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs ios-muted">
              {activeProject ? <span className="min-w-0 truncate">项目 {activeProject.name}</span> : null}
              <span className="min-w-0 truncate">可用 {formatCents(usage.remainingCostCents)}</span>
              <span className="min-w-0 truncate">下次刷新 {formatShortDateTime(usage.windowEnd)}</span>
              {activeModel ? (
                <ContextBadge
                  contextStats={lastContextStats}
                  model={activeModel}
                  contextWindowTokens={activeModel.contextWindowTokens}
                />
              ) : null}
            </div>
          </div>

          <div className="min-w-0 justify-self-stretch pr-1 lg:block lg:shrink-0 lg:justify-self-auto lg:pr-0">
            <div className="flex w-full min-w-0 items-center gap-2 lg:w-auto">
              {projects.length > 0 ? (
                <label className="app-glass-control hidden h-10 min-w-0 items-center gap-2 rounded-2xl px-3 text-xs font-semibold text-stone-700 sm:flex">
                  <FolderOpen className="size-4 shrink-0 text-[color:var(--claude-accent)]" />
                  <select
                    className="max-w-36 min-w-0 bg-transparent outline-none lg:max-w-48"
                    onChange={(event) => void changeActiveProject(event.target.value)}
                    title="选择项目"
                    value={activeProjectId}
                  >
                    <option value="">账号默认</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <button
                aria-label="临时聊天"
                aria-pressed={temporaryChatEnabled}
                className={`${chatHeaderIconButtonClass} ${
                  temporaryChatEnabled
                    ? "app-chat-header-button-active"
                    : "text-[color:var(--app-ink-soft)]"
                }`}
                disabled={securityModeDefault || loading || quotaBlocked || conversationSwitching}
                onClick={() => {
                  if (securityModeDefault) {
                    return;
                  }

                  setTemporaryChatEnabled(!temporaryChatEnabled);
                }}
                title={
                  securityModeDefault
                    ? "隐私 / 安全模式已强制开启临时聊天"
                    : temporaryChatEnabled
                      ? "已开启临时聊天：不保存历史，不读取或写入长期记忆"
                      : "临时聊天：不保存历史，不读取或写入长期记忆"
                }
                type="button"
              >
                <Clock3 className="size-4" />
              </button>
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

          <button
            className={`${chatHeaderIconButtonClass} lg:hidden`}
            onClick={startNewConversation}
            title="新聊天"
            type="button"
          >
            <MessageSquarePlus className="size-5" />
          </button>
        </div>
      </div>
    </header>
  );
}
