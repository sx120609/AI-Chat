"use client";

import { useMemo } from "react";
import {
  LogOut,
  Menu,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Search,
  Share2,
  Shield,
  Trash2,
  UserRound,
  X,
  Loader2,
  Gauge
} from "lucide-react";
import type { ConversationSummary, UsageSummary, UserView } from "@/types/gateway";
import { SiteLogo } from "@/components/site-logo";
import { formatCents, formatNumber, formatShortDateTime } from "@/lib/format";
import { groupConversations, usagePercent } from "./utils";

type UsageBarsProps = {
  compact?: boolean;
  onRecharge: () => void;
  paymentEnabled: boolean;
  usage: UsageSummary;
};

function UsageBars({
  compact = false,
  onRecharge,
  paymentEnabled,
  usage
}: UsageBarsProps) {
  const costPercent = usagePercent(
    usage.subscriptionCostUsedCents,
    usage.monthlyCostLimitCents
  );

  if (compact) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-stone-800">
            <Gauge className="size-3.5 shrink-0 text-[color:var(--claude-accent)]" />
            <span className="shrink-0">可用</span>
            <span className="min-w-0 truncate ios-muted">
              剩余 {formatCents(usage.remainingCostCents)}
            </span>
          </div>
          {paymentEnabled ? (
            <button
              className="app-action-button shrink-0 rounded-lg bg-white/70 px-2 py-0.5 text-[10px] font-semibold text-[color:var(--claude-accent)] transition hover:bg-white"
              onClick={onRecharge}
              type="button"
            >
              充值
            </button>
          ) : null}
        </div>
        <div className="h-1 overflow-hidden rounded-full border border-white/45 bg-white/45 shadow-[inset_0_1px_2px_rgba(18,42,35,0.08)] backdrop-blur-xl">
          <div
            className="app-progress-fill h-full rounded-full bg-[color:var(--claude-accent)]"
            style={{ width: `${costPercent}%` }}
          />
        </div>
        <div className="flex items-center justify-between gap-2 text-[10px] leading-4 ios-muted">
          <span className="min-w-0 truncate">
            订阅 {formatCents(usage.subscriptionRemainingCostCents)} · 点数 {formatCents(usage.aiPointsBalanceCents)}
          </span>
          <span className="shrink-0">{costPercent}%</span>
        </div>
        <p className="truncate text-[10px] leading-4 ios-muted">
          下次刷新 {formatShortDateTime(usage.windowEnd)}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 lg:space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-800 lg:gap-2 lg:text-sm">
          <Gauge className="size-3.5 text-[color:var(--claude-accent)] lg:size-4" />
          可用额度
        </div>
        {paymentEnabled ? (
          <button
            className="app-action-button rounded-lg bg-white/70 px-2 py-1 text-[11px] font-semibold text-[color:var(--claude-accent)] transition hover:bg-white"
            onClick={onRecharge}
            type="button"
          >
            充值
          </button>
        ) : null}
      </div>
      <div>
        <div className="mb-0.5 flex items-center justify-between gap-2 text-[11px] ios-muted lg:mb-1 lg:text-xs">
          <span>订阅额度</span>
          <span>剩余 {formatCents(usage.remainingCostCents)}</span>
        </div>
        <p className="mb-1 text-[10px] ios-muted lg:text-[11px]">
          订阅已用 {formatCents(usage.subscriptionCostUsedCents)} / {formatCents(usage.monthlyCostLimitCents)}
        </p>
        <div className="h-1.5 overflow-hidden rounded-full border border-white/45 bg-white/45 shadow-[inset_0_1px_2px_rgba(18,42,35,0.08)] backdrop-blur-xl lg:h-2">
          <div
            className="app-progress-fill h-full rounded-full bg-[color:var(--claude-accent)]"
            style={{
              width: `${costPercent}%`
            }}
          />
        </div>
        <p className="mt-1 text-[10px] leading-4 ios-muted lg:mt-2 lg:text-[11px] lg:leading-5">
          AI 点数 {formatCents(usage.aiPointsBalanceCents)} · 累计 {formatNumber(usage.messagesUsed)} 条 ·{" "}
          {formatNumber(usage.tokensUsed)} tokens
        </p>
        <p className="mt-1 text-[10px] leading-4 ios-muted lg:text-[11px]">
          下次刷新 {formatShortDateTime(usage.windowEnd)}
        </p>
      </div>
    </div>
  );
}

type SidebarProps = {
  user: UserView;
  siteSettings: { siteName: string };
  desktopSidebarOpen: boolean;
  toggleSidebar: () => void;
  logout: () => void;
  startNewConversation: () => void;
  conversationSearch: string;
  setConversationSearch: (value: string) => void;
  usage: UsageSummary;
  paymentEnabled: boolean;
  setPaymentDialogOpen: (open: boolean) => void;
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  runningGenerationKeySet: Set<string>;
  renamingConversationId: string | null;
  submitRenameConversation: (id: string) => Promise<void>;
  renamingTitle: string;
  setRenamingTitle: (title: string) => void;
  cancelRenameConversation: () => void;
  openConversation: (id: string) => void;
  openConversationMenuId: string | null;
  setOpenConversationMenuId: (id: string | null) => void;
  togglePinConversation: (conversation: ConversationSummary) => Promise<void>;
  beginRenameConversation: (conversation: ConversationSummary) => void;
  sharingConversationId: string | null;
  shareConversation: (conversation: ConversationSummary) => Promise<void>;
  requestDeleteConversation: (conversation: ConversationSummary) => void;
};

export function Sidebar({
  user,
  siteSettings,
  desktopSidebarOpen,
  toggleSidebar,
  logout,
  startNewConversation,
  conversationSearch,
  setConversationSearch,
  usage,
  paymentEnabled,
  setPaymentDialogOpen,
  conversations,
  activeConversationId,
  runningGenerationKeySet,
  renamingConversationId,
  submitRenameConversation,
  renamingTitle,
  setRenamingTitle,
  cancelRenameConversation,
  openConversation,
  openConversationMenuId,
  setOpenConversationMenuId,
  togglePinConversation,
  beginRenameConversation,
  sharingConversationId,
  shareConversation,
  requestDeleteConversation
}: SidebarProps) {
  const groupedConversations = useMemo(() => groupConversations(conversations), [conversations]);
  const sidebarHeaderButtonClass =
    "app-action-button app-glass-control min-h-9 min-w-9 shrink-0 place-items-center rounded-xl text-[color:var(--app-ink-soft)] transition hover:text-[color:var(--claude-ink)] active:scale-95";

  return (
    <>
      <div className="border-b border-[color:var(--ios-separator)] p-4 max-lg:border-b-0 max-lg:px-0 max-lg:pb-3 max-lg:pt-[calc(1rem+var(--app-safe-area-top,0px))]">
        <div className="flex items-center justify-between gap-3 max-lg:px-5 max-lg:pr-16">
          <div className="flex min-w-0 items-center gap-2">
            <SiteLogo className="hidden size-8 shrink-0 lg:block" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-stone-800 max-lg:text-[1.65rem] max-lg:font-bold max-lg:leading-9">
                {siteSettings.siteName}
              </p>
              <p className="mt-1 truncate text-xs ios-muted max-lg:hidden">{user.email}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              aria-expanded={desktopSidebarOpen}
              className={`${sidebarHeaderButtonClass} hidden lg:grid`}
              onClick={toggleSidebar}
              title="收起会话列表"
              type="button"
            >
              <Menu className="size-4" />
            </button>
            <button
              className={`${sidebarHeaderButtonClass} hidden lg:grid`}
              onClick={logout}
              title="退出登录"
              type="button"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
        <div className="mt-4 hidden gap-2 lg:flex">
          <button
            className="app-action-button app-glass-primary flex h-10 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition active:scale-[0.99]"
            onClick={startNewConversation}
            type="button"
          >
            <MessageSquarePlus className="size-4" />
            新聊天
          </button>
        </div>
        <div className="mt-3 hidden lg:block">
          <label className="app-glass-control flex h-9 items-center gap-2 rounded-xl px-2.5 text-sm text-stone-700 max-lg:h-11 max-lg:rounded-2xl max-lg:px-3.5">
            <Search className="size-4 shrink-0 text-stone-400" />
            <input
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-stone-400 max-lg:text-[15px]"
              onChange={(event) => setConversationSearch(event.target.value)}
              placeholder="搜索聊天"
              value={conversationSearch}
            />
            {conversationSearch ? (
              <button
                className="grid size-5 shrink-0 place-items-center rounded-md text-stone-400 hover:bg-stone-200/70 hover:text-stone-700"
                onClick={() => setConversationSearch("")}
                title="清空搜索"
                type="button"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </label>
        </div>
        <div className="mx-5 mt-5 grid grid-cols-2 gap-2 lg:hidden" data-mobile-sidebar-actions>
          <button
            className="app-action-button flex h-11 min-w-0 items-center justify-center gap-2 rounded-2xl border border-white/50 bg-white/45 px-3 text-[15px] font-semibold text-stone-800 shadow-[0_12px_34px_rgba(18,42,35,0.1),inset_0_1px_0_rgba(255,255,255,0.72)] backdrop-blur-xl transition active:scale-[0.99]"
            onClick={startNewConversation}
            type="button"
          >
            <MessageSquarePlus className="size-4 shrink-0" />
            <span className="min-w-0 truncate">新聊天</span>
          </button>
          <label className="app-glass-control flex h-11 min-w-0 items-center gap-2 rounded-2xl px-3.5 text-[15px] font-semibold text-stone-700">
            <Search className="size-4 shrink-0 text-stone-400" />
            <input
              className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none placeholder:text-stone-400"
              onChange={(event) => setConversationSearch(event.target.value)}
              placeholder="搜索聊天"
              value={conversationSearch}
            />
            {conversationSearch ? (
              <button
                className="grid size-5 shrink-0 place-items-center rounded-md text-stone-400 hover:bg-stone-200/70 hover:text-stone-700"
                onClick={() => setConversationSearch("")}
                title="清空搜索"
                type="button"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </label>
        </div>
      </div>

      <div className="hidden border-b border-white/40 p-2.5 lg:block lg:p-4">
        <UsageBars
          onRecharge={() => setPaymentDialogOpen(true)}
          paymentEnabled={paymentEnabled}
          usage={usage}
        />
      </div>

      <div
        className="mx-5 mb-2 mt-1 rounded-2xl border border-white/45 bg-white/36 px-3 py-2 shadow-[0_10px_30px_rgba(18,42,35,0.08),inset_0_1px_0_rgba(255,255,255,0.68)] backdrop-blur-xl lg:hidden"
        data-mobile-quota-card
      >
        <UsageBars
          compact
          onRecharge={() => setPaymentDialogOpen(true)}
          paymentEnabled={paymentEnabled}
          usage={usage}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 max-lg:px-5 max-lg:pb-20 max-lg:pt-1">
        {groupedConversations.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs leading-5 ios-muted">
            {conversationSearch.trim() ? "没有找到匹配的聊天。" : "暂无会话。"}
          </div>
        ) : null}

        {groupedConversations.map((group) => (
          <section className="mb-3 max-lg:mb-2" key={group.label}>
            <div className="px-0 py-2 text-[13px] font-semibold text-stone-500 lg:px-2 lg:py-1 lg:text-[11px]">
              {group.label}
            </div>
            <div className="space-y-1">
              {group.conversations.map((conversation) => {
                const active = conversation.id === activeConversationId;
                const menuOpen = openConversationMenuId === conversation.id;
                const running = runningGenerationKeySet.has(conversation.id);
                const renaming = renamingConversationId === conversation.id;

                return (
                  <div
                    className={`app-list-row group relative flex items-center gap-2 rounded-xl px-2 py-2.5 transition lg:rounded-lg lg:py-2 ${
                      menuOpen ? "z-30" : "z-0"
                    } ${
                      active
                        ? "border border-white/45 bg-white/48 text-stone-950 shadow-[0_10px_30px_rgba(18,42,35,0.08),inset_0_1px_0_rgba(255,255,255,0.72)] backdrop-blur-xl"
                        : "border border-transparent text-stone-700 hover:border-white/40 hover:bg-white/35 hover:shadow-[0_10px_28px_rgba(18,42,35,0.07)] hover:backdrop-blur-xl"
                    }`}
                    key={conversation.id}
                  >
                    {renaming ? (
                      <form
                        className="min-w-0 flex-1"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void submitRenameConversation(conversation.id);
                        }}
                      >
                        <input
                          autoFocus
                          className="h-8 w-full rounded-md border border-[color:var(--claude-accent)] bg-white px-2 text-sm font-medium text-stone-900 outline-none"
                          maxLength={80}
                          onBlur={() => void submitRenameConversation(conversation.id)}
                          onChange={(event) => setRenamingTitle(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              cancelRenameConversation();
                            }
                          }}
                          value={renamingTitle}
                        />
                      </form>
                    ) : (
                      <button
                        className="min-w-0 flex-1 text-left"
                        onClick={() => openConversation(conversation.id)}
                        type="button"
                      >
                        <div className="flex min-w-0 items-center gap-1.5">
                          {conversation.pinned ? (
                            <Pin className="size-3.5 shrink-0 text-[color:var(--claude-accent)]" />
                          ) : null}
                          {running ? (
                            <Loader2 className="size-3.5 shrink-0 animate-spin text-[color:var(--claude-accent)]" />
                          ) : null}
                          <p className="min-w-0 truncate text-[15px] font-semibold leading-5 lg:text-sm lg:font-medium">
                            {conversation.title}
                          </p>
                        </div>
                        <p className="mt-0.5 truncate text-xs ios-muted max-lg:hidden">
                          {conversation.projectName ? `${conversation.projectName} · ` : ""}
                          {conversation.mode === "IMAGE" ? "image2" : conversation.model}
                          {conversation._count ? ` · ${conversation._count.messages} 条消息` : ""}
                          {running ? " · 生成中" : ""}
                        </p>
                      </button>
                    )}

                    {!renaming ? (
                      <button
                        data-conversation-menu
                        className={`app-action-button relative z-20 grid size-8 shrink-0 place-items-center rounded-lg text-stone-400 hover:bg-white/65 hover:text-stone-800 lg:size-7 ${
                          menuOpen ? "app-glass-control text-stone-800 opacity-100" : "lg:opacity-0 lg:group-hover:opacity-100"
                        }`}
                        onClick={() =>
                          setOpenConversationMenuId(
                            openConversationMenuId === conversation.id ? null : conversation.id
                          )
                        }
                        title="会话操作"
                        type="button"
                      >
                        <MoreHorizontal className="size-4" />
                      </button>
                    ) : null}

                    {menuOpen ? (
                      <div
                        className="app-menu-enter app-glass-panel absolute right-10 top-1 z-40 w-36 overflow-hidden rounded-xl p-1 text-xs lg:right-9"
                        data-conversation-menu
                      >
                        <button
                          className="app-action-button flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-stone-700 hover:bg-[color:var(--app-accent-soft)]"
                          onClick={() => void togglePinConversation(conversation)}
                          type="button"
                        >
                          {conversation.pinned ? (
                            <PinOff className="size-3.5" />
                          ) : (
                            <Pin className="size-3.5" />
                          )}
                          {conversation.pinned ? "取消固定" : "固定"}
                        </button>
                        <button
                          className="app-action-button flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-stone-700 hover:bg-[color:var(--app-accent-soft)]"
                          onClick={() => beginRenameConversation(conversation)}
                          type="button"
                        >
                          <Pencil className="size-3.5" />
                          重命名
                        </button>
                        <button
                          className="app-action-button flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-stone-700 hover:bg-[color:var(--app-accent-soft)] disabled:opacity-50"
                          disabled={sharingConversationId === conversation.id}
                          onClick={() => void shareConversation(conversation)}
                          type="button"
                        >
                          <Share2 className="size-3.5" />
                          分享
                        </button>
                        <button
                          className="app-action-button flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-red-600 hover:bg-red-50"
                          onClick={() => requestDeleteConversation(conversation)}
                          type="button"
                        >
                          <Trash2 className="size-3.5" />
                          删除
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="m-3 hidden gap-2 lg:grid">
        <a
          className="app-action-button app-glass-control flex h-10 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold text-stone-700 transition"
          href="/profile"
        >
          <UserRound className="size-4" />
          个人中心
        </a>
        {user.role === "ADMIN" ? (
          <a
            className="app-action-button app-glass-control flex h-10 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold text-stone-700 transition"
            href="/admin"
          >
            <Shield className="size-4" />
            管理后台
          </a>
        ) : null}
      </div>
      <div className="mx-5 mb-[calc(0.75rem+env(safe-area-inset-bottom))] mt-2 grid gap-2 lg:hidden">
        <a
          className="app-action-button flex h-11 items-center gap-3 rounded-2xl border border-white/50 bg-white/45 px-3 text-[15px] font-semibold text-stone-700 shadow-[0_12px_34px_rgba(18,42,35,0.08),inset_0_1px_0_rgba(255,255,255,0.72)] backdrop-blur-xl transition active:scale-[0.99]"
          href="/profile"
        >
          <UserRound className="size-4" />
          个人中心
        </a>
        {user.role === "ADMIN" ? (
          <a
            className="app-action-button flex h-11 items-center gap-3 rounded-2xl border border-white/50 bg-white/45 px-3 text-[15px] font-semibold text-stone-700 shadow-[0_12px_34px_rgba(18,42,35,0.08),inset_0_1px_0_rgba(255,255,255,0.72)] backdrop-blur-xl transition active:scale-[0.99]"
            href="/admin"
          >
            <Shield className="size-4" />
            管理后台
          </a>
        ) : null}
      </div>
    </>
  );
}
