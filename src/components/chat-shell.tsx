"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Clock3,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Search,
  X
} from "lucide-react";
import { SiteConfirmDialog } from "@/components/site-dialog";
import { formatNumber } from "@/lib/format";
import { ChatShellProps, ContextStats, ShareNotice } from "./chat/types";
import { useChat } from "./chat/hooks/use-chat";
import { Sidebar } from "./chat/sidebar";
import { Header } from "./chat/header";
import { MessageList } from "./chat/message-list";
import { ComposerInputArea } from "./chat/composer-input";
import { EasyPayDialog } from "./chat/easy-pay-dialog";
import { AttachmentChip, ProcessTimelinePanel } from "./chat/message-bubble";

function ContextNotice({ lastContextStats }: { lastContextStats: ContextStats | null }) {
  if (!lastContextStats) {
    return null;
  }

  const shouldWarn =
    lastContextStats.longContextThresholdExceeded ||
    lastContextStats.omittedHistoryMessageCount > 0 ||
    lastContextStats.contextWindowPercent >= 70;

  if (!shouldWarn) {
    return null;
  }

  const message = lastContextStats.longContextThresholdExceeded
    ? "当前会话已进入长上下文区间，可能额外计费、变慢，并让模型注意力分散导致降智；建议开启新会话。"
    : lastContextStats.omittedHistoryMessageCount > 0
      ? `上轮请求已自动裁剪 ${formatNumber(lastContextStats.omittedHistoryMessageCount)} 条较早历史；需要完整上下文时建议开启新会话或手动整理摘要。`
      : "当前会话已经很长，后续可能需要裁剪早期历史；复杂问题建议新开会话。";

  return (
    <div className="app-inline-alert mb-2 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs leading-5 text-amber-900 shadow-[0_12px_34px_rgba(146,64,14,0.08)] backdrop-blur-xl">
      {message}
    </div>
  );
}

function ShareNoticeToast({
  notice,
  onCopy,
  onDismiss
}: {
  notice: ShareNotice | null;
  onCopy: () => void;
  onDismiss: () => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !notice) {
    return null;
  }

  const success = notice.tone === "success";

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[75] grid place-items-center px-4 py-[calc(1rem+env(safe-area-inset-top))] sm:block sm:p-0">
      <section
        className={`app-reveal pointer-events-auto w-full max-w-[24rem] overflow-hidden rounded-2xl border bg-white/82 p-3 text-stone-900 shadow-[0_20px_70px_rgba(18,42,35,0.22),inset_0_1px_0_rgba(255,255,255,0.78)] backdrop-blur-2xl sm:absolute sm:right-6 sm:top-6 sm:w-[24rem] ${
          success ? "border-emerald-200" : "border-red-200"
        }`}
        role="status"
      >
        <div className="flex items-start gap-3">
          <span
            className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ${
              success ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"
            }`}
          >
            {success ? <Check className="size-4" /> : <X className="size-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-semibold leading-5">{notice.title}</p>
              <button
                className="app-action-button grid size-7 shrink-0 place-items-center rounded-full text-stone-400 transition hover:bg-white/70 hover:text-stone-900"
                onClick={onDismiss}
                title="关闭"
                type="button"
              >
                <X className="size-3.5" />
              </button>
            </div>
            {notice.description ? (
              <p className="mt-1 text-xs leading-5 text-stone-600">{notice.description}</p>
            ) : null}
            {notice.url ? (
              <div className="mt-3 flex items-center gap-2">
                <button
                  className="app-action-button app-glass-control flex h-9 flex-1 items-center justify-center gap-2 rounded-full px-3 text-xs font-semibold text-stone-700 transition"
                  onClick={onCopy}
                  type="button"
                >
                  <Copy className="size-3.5" />
                  复制链接
                </button>
                <a
                  className="app-action-button flex h-9 flex-1 items-center justify-center gap-2 rounded-full bg-[color:var(--claude-accent)] px-3 text-xs font-semibold text-white transition hover:bg-[color:var(--claude-accent-dark)]"
                  href={notice.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  <ExternalLink className="size-3.5" />
                  打开链接
                </a>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}

export function ChatShell(props: ChatShellProps) {
  const {
    user,
    siteSettings,
    usage,
    paymentSettings,
    chatModels,
    projects,
    activeProjectId,
    conversations,
    activeConversationId,
    conversationSearch,
    renamingConversationId,
    renamingTitle,
    openConversationMenuId,
    deleteConversationTarget,
    deletingConversationId,
    deleteMessageTarget,
    deletingMessageId,
    sharingConversationId,
    shareNotice,
    messages,
    imageToolEnabled,
    sourceImageMessage,
    webSearchEnabledForMessage,
    temporaryChatEnabled,
    model,
    reasoningEffort,
    composerDraft,
    pendingAttachments,
    editingMessage,
    error,
    paymentDialogOpen,
    draggingFiles,
    uploadingAttachments,
    modelPickerOpen,
    mobileSidebarOpen,
    desktopSidebarOpen,
    streamStatus,
    toolEvents,
    processTimelineExpanded,
    processStartedAt,
    processFinishedAt,
    processNow,
    lastContextStats,

    // Refs
    fileInputRef,
    headerControlsRef,
    messageScrollRef,
    scrollRef,

    // Derived State
    quotaBlocked,
    imageGenerationAvailable,
    fileAnalysisAvailable,
    webSearchToolAvailable,
    runningGenerationKeySet,
    loading,
    conversationSwitching,
    activeConversation,
    activeProject,
    activeModel,
    messageModelLabels,
    webSearchProviderLabel,
    inlineProcessMessageId,
    deleteMessagePreview,

    // Actions
    setPaymentDialogOpen,
    setConversationSearch,
    setRenamingTitle,
    setOpenConversationMenuId,
    setDeleteConversationTarget,
    setDeleteMessageTarget,
    setShareNotice,
    setWebSearchEnabledForMessage,
    setImageToolEnabled,
    setTemporaryChatEnabled,
    setModel,
    setReasoningEffort,
    setModelPickerOpen,
    setMobileSidebarOpen,
    setProcessTimelineExpanded,
    setError,
    setSourceImageMessage,

    // Functions
    logout,
    startNewConversation,
    changeActiveProject,
    beginRenameConversation,
    cancelRenameConversation,
    submitRenameConversation,
    togglePinConversation,
    shareConversation,
    copyShareNoticeUrl,
    requestDeleteConversation,
    deleteConversation,
    openConversation,
    toggleSidebar,
    uploadAttachments,
    removePendingAttachment,
    handleFileDragEnter,
    handleFileDragLeave,
    handleFileDragOver,
    handleFileDrop,
    cancelEditMessage,
    updateAutoScrollState,

    // Event Handlers
    copyMessageHandler,
    deleteMessageHandler,
    confirmDeleteMessageHandler,
    editMessageHandler,
    editImageHandler,
    regenerateMessageHandler,
    continueGeneratingHandler,
    sendHandler,
    stopGenerationHandler,
    securityModeDefault
  } = useChat(props);

  return (
    <>
      <main className="ios-page app-shell app-route-enter flex text-stone-950">
      <aside
        className={`ios-glass app-glass-sidebar app-sidebar-sheet hidden h-full w-80 shrink-0 border-r border-white/40 ${
          desktopSidebarOpen ? "lg:flex lg:flex-col" : "lg:hidden"
        }`}
      >
        <Sidebar
          user={user}
          siteSettings={siteSettings}
          desktopSidebarOpen={desktopSidebarOpen}
          toggleSidebar={toggleSidebar}
          logout={logout}
          startNewConversation={startNewConversation}
          conversationSearch={conversationSearch}
          setConversationSearch={setConversationSearch}
          usage={usage}
          paymentEnabled={paymentSettings.easyPayEnabled}
          setPaymentDialogOpen={setPaymentDialogOpen}
          conversations={conversations}
          activeConversationId={activeConversationId}
          runningGenerationKeySet={runningGenerationKeySet}
          renamingConversationId={renamingConversationId}
          submitRenameConversation={submitRenameConversation}
          renamingTitle={renamingTitle}
          setRenamingTitle={setRenamingTitle}
          cancelRenameConversation={cancelRenameConversation}
          openConversation={openConversation}
          openConversationMenuId={openConversationMenuId}
          setOpenConversationMenuId={setOpenConversationMenuId}
          togglePinConversation={togglePinConversation}
          beginRenameConversation={beginRenameConversation}
          sharingConversationId={sharingConversationId}
          shareConversation={shareConversation}
          requestDeleteConversation={requestDeleteConversation}
        />
      </aside>

      {mobileSidebarOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="关闭侧栏"
            className="app-backdrop-enter absolute inset-0 bg-black/20"
            onClick={() => setMobileSidebarOpen(false)}
            type="button"
          />
          <aside className="ios-glass app-sidebar-sheet absolute inset-0 flex flex-col text-stone-950 shadow-none">
            <button
              className="app-action-button absolute right-5 top-[calc(1rem+var(--app-safe-area-top,0px))] z-20 grid size-10 place-items-center rounded-full border border-white/50 bg-white/45 text-[color:var(--app-ink-soft)] shadow-[0_12px_34px_rgba(18,42,35,0.12),inset_0_1px_0_rgba(255,255,255,0.72)] backdrop-blur-xl transition active:scale-95"
              onClick={() => setMobileSidebarOpen(false)}
              title="关闭"
              type="button"
            >
              <X className="size-[18px]" />
            </button>
            <Sidebar
              user={user}
              siteSettings={siteSettings}
              desktopSidebarOpen={desktopSidebarOpen}
              toggleSidebar={toggleSidebar}
              logout={logout}
              startNewConversation={startNewConversation}
              conversationSearch={conversationSearch}
              setConversationSearch={setConversationSearch}
              usage={usage}
              paymentEnabled={paymentSettings.easyPayEnabled}
              setPaymentDialogOpen={setPaymentDialogOpen}
              conversations={conversations}
              activeConversationId={activeConversationId}
              runningGenerationKeySet={runningGenerationKeySet}
              renamingConversationId={renamingConversationId}
              submitRenameConversation={submitRenameConversation}
              renamingTitle={renamingTitle}
              setRenamingTitle={setRenamingTitle}
              cancelRenameConversation={cancelRenameConversation}
              openConversation={openConversation}
              openConversationMenuId={openConversationMenuId}
              setOpenConversationMenuId={setOpenConversationMenuId}
              togglePinConversation={togglePinConversation}
              beginRenameConversation={beginRenameConversation}
              sharingConversationId={sharingConversationId}
              shareConversation={shareConversation}
              requestDeleteConversation={requestDeleteConversation}
            />
          </aside>
        </div>
      ) : null}

      <section
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
        onDragEnter={handleFileDragEnter}
        onDragLeave={handleFileDragLeave}
        onDragOver={handleFileDragOver}
        onDrop={handleFileDrop}
      >
        {draggingFiles ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-3 z-40 grid place-items-center rounded-[1.25rem] border-2 border-dashed border-[color:var(--claude-accent)] bg-[color:var(--app-surface)] shadow-[0_24px_80px_rgba(18,42,35,0.18)] backdrop-blur-sm"
          >
            <div className="app-status-pill app-glass-control inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-stone-800">
              <Paperclip className="size-4 text-[color:var(--claude-accent)]" />
              松开以上传文件
            </div>
          </div>
        ) : null}

        <Header
          desktopSidebarOpen={desktopSidebarOpen}
          mobileSidebarOpen={mobileSidebarOpen}
          toggleSidebar={toggleSidebar}
          headerControlsRef={headerControlsRef}
          activeModel={activeModel}
          lastContextStats={lastContextStats}
          activeConversation={activeConversation}
          activeProject={activeProject}
          projects={projects}
          activeProjectId={activeProjectId}
          changeActiveProject={changeActiveProject}
          usage={usage}
          temporaryChatEnabled={temporaryChatEnabled}
          securityModeDefault={securityModeDefault}
          loading={loading}
          conversationSwitching={conversationSwitching}
          quotaBlocked={quotaBlocked}
          setTemporaryChatEnabled={setTemporaryChatEnabled}
          chatModels={chatModels}
          model={model}
          setModel={setModel}
          reasoningEffort={reasoningEffort}
          setReasoningEffort={setReasoningEffort}
          modelPickerOpen={modelPickerOpen}
          setModelPickerOpen={setModelPickerOpen}
          startNewConversation={startNewConversation}
        />

        <MessageList
          messages={messages}
          conversationSwitching={conversationSwitching}
          activeProject={activeProject}
          activeModel={activeModel}
          model={model}
          imageToolEnabled={imageToolEnabled}
          inlineProcessMessageId={inlineProcessMessageId}
          toolEvents={toolEvents}
          processTimelineExpanded={processTimelineExpanded}
          setProcessTimelineExpanded={setProcessTimelineExpanded}
          processFinishedAt={processFinishedAt}
          processStartedAt={processStartedAt}
          processNow={processNow}
          streamStatus={streamStatus}
          messageModelLabels={messageModelLabels}
          scrollRef={scrollRef}
          messageScrollRef={messageScrollRef}
          updateAutoScrollState={updateAutoScrollState}
          continueGeneratingHandler={continueGeneratingHandler}
          copyMessageHandler={copyMessageHandler}
          deleteMessageHandler={deleteMessageHandler}
          editMessageHandler={editMessageHandler}
          editImageHandler={editImageHandler}
          regenerateMessageHandler={regenerateMessageHandler}
        />

        <footer className="shrink-0 border-t border-[color:var(--ios-separator)] bg-[color:var(--app-surface)] px-3 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 backdrop-blur sm:border-0 sm:bg-transparent sm:px-6 sm:pb-6 sm:pt-0 sm:backdrop-blur-none">
          <div className="mx-auto max-w-3xl">
            {activeModel ? (
              <ContextNotice lastContextStats={lastContextStats} />
            ) : null}
            {imageGenerationAvailable && imageToolEnabled ? (
              <div className="app-status-pill app-glass-control mb-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium text-stone-700">
                <ImageIcon className="size-3.5 text-[color:var(--claude-accent)]" />
                {sourceImageMessage
                  ? "下一条会优先走 image2 编辑所选图片"
                  : "下一条会优先走 image2 生图"}
              </div>
            ) : null}
            {webSearchToolAvailable && webSearchEnabledForMessage ? (
              <div className="app-status-pill app-glass-control mb-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium text-stone-700">
                <Search className="size-3.5 text-[color:var(--claude-accent)]" />
                下一条将联网搜索（{webSearchProviderLabel}）
              </div>
            ) : null}
            {temporaryChatEnabled ? (
              <div className="app-status-pill app-glass-control mb-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium text-stone-700">
                <Clock3 className="size-3.5 text-[color:var(--claude-accent)]" />
                临时聊天：不保存历史，不读取或写入长期记忆
              </div>
            ) : null}
            {toolEvents.length > 0 && processStartedAt && !inlineProcessMessageId ? (
              <ProcessTimelinePanel
                events={toolEvents}
                expanded={processTimelineExpanded}
                finishedAt={processFinishedAt}
                now={processNow}
                onExpandedChange={setProcessTimelineExpanded}
                startedAt={processStartedAt}
                status={streamStatus}
              />
            ) : streamStatus ? (
              <div className="app-status-pill app-glass-control mb-3 flex items-center gap-2 rounded-full px-3 py-1 text-xs text-stone-600">
                {loading ? <Loader2 className="size-3.5 animate-spin" /> : null}
                <span>{streamStatus}</span>
              </div>
            ) : null}
            {error && error.trim() && !error.toLowerCase().includes("network error") && !error.toLowerCase().includes("gateway") ? (
              <div className="app-inline-alert mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            ) : null}
            {quotaBlocked ? (
              <div className="app-inline-alert mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                余额不足，请联系管理员。
              </div>
            ) : null}
            {editingMessage ? (
              <div className="app-status-pill app-glass-control mb-2 flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs text-stone-700">
                <span className="min-w-0 truncate">正在编辑上一条消息</span>
                <button
                  className="shrink-0 font-semibold text-[color:var(--claude-accent)]"
                  onClick={cancelEditMessage}
                  type="button"
                >
                  取消
                </button>
              </div>
            ) : null}
            {sourceImageMessage?.imageUrl ? (
              <div className="app-status-pill app-glass-control mb-2 flex max-w-full items-center gap-2 rounded-xl px-2 py-2 text-xs text-stone-700">
                <img
                  alt="待编辑图片"
                  className="size-12 shrink-0 rounded-md object-cover"
                  src={sourceImageMessage.imageUrl}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-stone-900">正在编辑这张图片</div>
                  <div className="truncate ios-muted">输入修改要求后会优先走 image2 编辑</div>
                </div>
                <button
                  className="grid size-7 shrink-0 place-items-center rounded-md text-stone-500 hover:bg-stone-200/60 hover:text-stone-900"
                  onClick={() => {
                    setSourceImageMessage(null);
                    setImageToolEnabled(false);
                    setError("");
                  }}
                  title="取消编辑图片"
                  type="button"
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : null}
            {pendingAttachments.length > 0 ? (
              <div className="mb-2 flex flex-wrap gap-2">
                {pendingAttachments.map((attachment) => (
                  <AttachmentChip
                    attachment={attachment}
                    key={attachment.id}
                    onRemove={() => removePendingAttachment(attachment.id)}
                  />
                ))}
              </div>
            ) : null}
            <div className="ios-panel app-glass-panel claude-composer app-composer flex min-h-11 items-center gap-1.5 px-1.5 py-0.5 sm:gap-2 sm:px-2">
              <input
                className="hidden"
                multiple
                onChange={(event) => void uploadAttachments(event.target.files)}
                ref={fileInputRef}
                type="file"
              />
              <div className="flex shrink-0 items-center gap-1">
                <button
                  className="app-action-button app-glass-control grid size-9 shrink-0 place-items-center rounded-full text-stone-600 transition disabled:opacity-50"
                  disabled={
                    !fileAnalysisAvailable ||
                    loading ||
                    quotaBlocked ||
                    uploadingAttachments ||
                    conversationSwitching
                  }
                  onClick={() => fileInputRef.current?.click()}
                  title={fileAnalysisAvailable ? "上传文件或图片" : "文件分析已关闭"}
                  type="button"
                >
                  {uploadingAttachments ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Paperclip className="size-4" />
                  )}
                </button>
                <button
                  className={`app-action-button grid size-9 shrink-0 place-items-center rounded-full border transition ${
                    imageToolEnabled
                      ? "border-[color:var(--claude-accent)] bg-[color:var(--app-accent-soft)] text-[color:var(--claude-accent-dark)]"
                      : "app-glass-control text-stone-600 sm:text-stone-600"
                  }`}
                  disabled={!imageGenerationAvailable || loading || quotaBlocked || conversationSwitching}
                  onClick={() => {
                    const nextImageToolEnabled = !imageToolEnabled;
                    setImageToolEnabled(nextImageToolEnabled);

                    if (!nextImageToolEnabled) {
                      setSourceImageMessage(null);
                    }

                    if (nextImageToolEnabled) {
                      setWebSearchEnabledForMessage(false);
                    }
                  }}
                  title={
                    imageGenerationAvailable
                      ? imageToolEnabled
                        ? "已开启：优先走 image2 生图"
                        : "优先走 image2 生图"
                      : "图片生成已关闭"
                  }
                  type="button"
                >
                  <ImageIcon className="size-4" />
                </button>
                {webSearchToolAvailable ? (
                  <div className="relative flex min-w-0 shrink-0 items-center">
                    <button
                      aria-pressed={webSearchEnabledForMessage}
                      className={`app-action-button grid size-9 place-items-center rounded-full border transition ${
                        webSearchEnabledForMessage
                          ? "border-[color:var(--claude-accent)] bg-[color:var(--app-accent-soft)] text-[color:var(--claude-accent-dark)]"
                          : "app-glass-control text-stone-600 sm:text-stone-600"
                      }`}
                      disabled={loading || quotaBlocked || conversationSwitching}
                      onClick={() => {
                        const nextWebSearchEnabled = !webSearchEnabledForMessage;
                        setWebSearchEnabledForMessage(nextWebSearchEnabled);

                        if (nextWebSearchEnabled) {
                          setImageToolEnabled(false);
                        }
                      }}
                      title={
                        webSearchEnabledForMessage
                          ? `已开启：下一条联网搜索（${webSearchProviderLabel}）`
                          : `下一条联网搜索（${webSearchProviderLabel}）`
                      }
                      type="button"
                    >
                      <Search className="size-4" />
                    </button>
                  </div>
                ) : null}
              </div>
              <ComposerInputArea
                disabled={conversationSwitching}
                draftFocusToken={composerDraft.focusToken}
                draftText={composerDraft.text}
                imageToolEnabled={imageGenerationAvailable && imageToolEnabled}
                loading={loading}
                onSend={sendHandler}
                onStop={stopGenerationHandler}
                pendingAttachmentCount={pendingAttachments.length}
                quotaBlocked={quotaBlocked}
                sourceImageSelected={sourceImageMessage !== null}
                uploadingAttachments={uploadingAttachments}
                webSearchEnabledForMessage={webSearchToolAvailable && webSearchEnabledForMessage}
              />
            </div>
          </div>
        </footer>
      </section>
    </main>

    <SiteConfirmDialog
      confirmLabel="删除会话"
      description={`确定删除「${deleteConversationTarget?.title || "这个会话"}」吗？删除后会话和其中的消息都会移除，此操作不可恢复。`}
      loading={Boolean(
        deleteConversationTarget && deletingConversationId === deleteConversationTarget.id
      )}
      onCancel={() => setDeleteConversationTarget(null)}
      onConfirm={() =>
        deleteConversationTarget ? deleteConversation(deleteConversationTarget.id) : undefined
      }
      open={Boolean(deleteConversationTarget)}
      title="删除会话"
      tone="danger"
    />

    <SiteConfirmDialog
      confirmLabel="删除消息"
      description={`确定删除这条${
        deleteMessageTarget?.role === "USER" ? "用户消息" : "AI 回复"
      }吗？删除后不可恢复。`}
      loading={Boolean(deleteMessageTarget && deletingMessageId === deleteMessageTarget.id)}
      onCancel={() => setDeleteMessageTarget(null)}
      onConfirm={confirmDeleteMessageHandler}
      open={Boolean(deleteMessageTarget)}
      title="删除消息"
      tone="danger"
    >
      {deleteMessageTarget ? (
        <div className="max-h-28 overflow-hidden rounded-xl border border-[color:var(--ios-separator)] bg-white/45 px-3 py-2 text-xs leading-5 text-stone-600">
          <p className="font-semibold text-stone-800">
            {deleteMessageTarget.role === "USER" ? "你发送的消息" : "AI 回复"}
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words">{deleteMessagePreview}</p>
        </div>
      ) : null}
    </SiteConfirmDialog>

    <EasyPayDialog
      onClose={() => setPaymentDialogOpen(false)}
      open={paymentDialogOpen}
      paymentSettings={paymentSettings}
    />

    <ShareNoticeToast
      notice={shareNotice}
      onCopy={() => void copyShareNoticeUrl()}
      onDismiss={() => setShareNotice(null)}
    />
  </>
  );
}
