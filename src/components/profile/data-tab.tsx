import { useState, type ComponentType } from "react";
import {
  FolderOpen,
  Download,
  Archive,
  Trash2,
  Shield,
  RotateCcw,
  Loader2,
  Database,
  Link2,
  Copy,
  File as FileIcon
} from "lucide-react";
import { formatCents, formatNumber } from "@/lib/format";
import { formatBytes } from "./components";
import type {
  ArchivedConversationView,
  UsageBreakdownPayload,
  UsageBucketView,
  UsageRecordView,
  SharedLinkView,
  FileLibraryItem,
  UserProjectView,
  DataControlAction
} from "./types";

type DataTabProps = {
  loadingDataLists: boolean;
  onRefreshDataLists: () => void;
  archivedConversations: ArchivedConversationView[];
  savingArchivedConversationId: string | null;
  onRestoreArchivedConversation: (id: string) => void;
  onSetDeleteArchivedConversationTarget: (convo: ArchivedConversationView) => void;
  onExportProfileData: () => void;
  onExportUsageCsv: () => void;
  onSetDataControlAction: (action: DataControlAction) => void;
  usageBreakdown: UsageBreakdownPayload | null;
  sharedLinks: SharedLinkView[];
  onCopyText: (text: string, message?: string) => void;
  onDeleteSharedLink: (id: string) => void;
  savingSharedLinkId: string | null;
  fileLibrary: FileLibraryItem[];
  fileLibraryTotal: number;
  fileLibraryHasMore: boolean;
  fileProjectFilter: string;
  onSetFileProjectFilter: (filter: string) => void;
  projects: UserProjectView[];
  visibleFileLibrary: FileLibraryItem[];
  savingFileId: string | null;
  onDeleteFile: (id: string) => void;
  loadingMoreFiles: boolean;
  onLoadMoreFiles: () => void;
  loadingUsageRecordsPage: boolean;
  onChangeUsageRecordsPage: (page: number) => void;
  onChangeUsageRecordsPageSize: (pageSize: number) => void;
  usageRecordsPageSize: number;
  origin: string;
};

type MobileDataSection = "usage" | "files" | "shared" | "archive" | "controls";

type MobileDataNavItem = {
  count?: number;
  icon: ComponentType<{ className?: string }>;
  id: MobileDataSection;
  label: string;
};

function formatPercent(value: number) {
  if (!Number.isFinite(value)) {
    return "0%";
  }

  return `${Math.round(Math.max(0, value) * 100)}%`;
}

function formatCompactCount(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "";
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  }

  return String(value);
}

function formatDuration(ms: number | null | undefined) {
  if (!Number.isFinite(ms ?? NaN) || !ms) {
    return "-";
  }

  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }

  return `${(ms / 1000).toFixed(ms >= 10_000 ? 1 : 2)}s`;
}

function usageModeLabel(mode: string) {
  return mode === "IMAGE" ? "图片" : "聊天";
}

function usageSourceLabel(source: string) {
  const lastSegment = source.split(":").at(-1);

  return lastSegment === "upstream" ? "上游 usage" : "估算";
}

function requestKindLabel(kind: string) {
  if (kind === "stream") {
    return "流式";
  }

  if (kind === "sync") {
    return "同步";
  }

  return kind || "-";
}

function quotaSourceLabel(source: string) {
  const labels: Record<string, string> = {
    AI_POINTS: "点数",
    MIXED: "订阅 + 点数",
    MONTHLY_SUBSCRIPTION: "订阅"
  };

  return labels[source] || source || "-";
}

function reasoningEffortLabel(value: string) {
  const labels: Record<string, string> = {
    high: "High",
    low: "Low",
    max: "Max",
    medium: "Medium",
    xhigh: "XHigh"
  };

  return labels[value] || value || "-";
}

function MobileDataSectionNav({
  activeSection,
  items,
  onChange
}: {
  activeSection: MobileDataSection;
  items: MobileDataNavItem[];
  onChange: (section: MobileDataSection) => void;
}) {
  return (
    <div className="md:hidden">
      <div className="grid grid-cols-5 gap-1 rounded-2xl border border-[color:var(--ios-separator)] bg-white/58 p-1 shadow-[0_14px_34px_rgba(32,38,32,0.08)] backdrop-blur">
        {items.map((item) => {
          const Icon = item.icon;
          const active = activeSection === item.id;
          const count = formatCompactCount(item.count ?? 0);

          return (
            <button
              aria-pressed={active}
              className={`app-action-button flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[11px] font-semibold transition ${
                active
                  ? "bg-[color:var(--claude-accent)] text-white shadow-sm"
                  : "text-stone-600 hover:bg-white/70"
              }`}
              key={item.id}
              onClick={() => onChange(item.id)}
              type="button"
            >
              <Icon className="size-4 shrink-0" />
              <span className="w-full truncate">{item.label}</span>
              {count ? (
                <span
                  className={`rounded-full px-1.5 text-[10px] leading-4 ${
                    active ? "bg-white/18 text-white" : "bg-stone-100 text-stone-500"
                  }`}
                >
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function UsageTokenLine({
  cachedPromptTokens,
  completionTokens,
  promptTokens,
  reasoningTokens,
  totalTokens
}: {
  cachedPromptTokens: number;
  completionTokens: number;
  promptTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}) {
  return (
    <div className="grid gap-1 text-xs ios-muted">
      <p className="font-semibold text-stone-900">总计 {formatNumber(totalTokens)}</p>
      <p>
        上行 {formatNumber(promptTokens)} · 下行 {formatNumber(completionTokens)}
      </p>
      <p>
        缓存 {formatNumber(cachedPromptTokens)} · 推理 {formatNumber(reasoningTokens)}
      </p>
    </div>
  );
}

function UsageBucketList({
  buckets,
  defaultOpen = false,
  title
}: {
  buckets: UsageBucketView[];
  defaultOpen?: boolean;
  title: string;
}) {
  const renderBody = () =>
    buckets.length === 0 ? (
      <p className="py-6 text-center text-sm ios-muted">暂无数据</p>
    ) : (
      <div className="grid max-h-56 gap-2 overflow-y-auto pr-1 md:max-h-72">
        {buckets.map((bucket) => (
          <div
            className="grid gap-1 rounded-lg bg-white/60 px-3 py-2 text-sm"
            key={bucket.key}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate font-semibold text-stone-900">{bucket.label}</span>
              <span className="shrink-0 text-xs font-semibold ios-muted">{formatCents(bucket.costCents)}</span>
            </div>
            <p className="text-xs ios-muted">
              {formatNumber(bucket.totalTokens)} tokens · {formatNumber(bucket.records)} 条
            </p>
            <p className="text-xs ios-muted">
              上行 {formatNumber(bucket.promptTokens)} · 下行 {formatNumber(bucket.completionTokens)} · 缓存{" "}
              {formatNumber(bucket.cachedPromptTokens)}
            </p>
          </div>
        ))}
      </div>
    );

  return (
    <>
      <div className="hidden rounded-lg border border-[color:var(--ios-separator)] bg-white/45 p-3 md:block">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-stone-950">{title}</h3>
          <span className="text-xs ios-muted">{buckets.length} 项</span>
        </div>
        {renderBody()}
      </div>
      <details
        className="rounded-lg border border-[color:var(--ios-separator)] bg-white/45 md:hidden"
        open={defaultOpen}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 [&::-webkit-details-marker]:hidden">
          <h3 className="text-sm font-semibold text-stone-950">{title}</h3>
          <span className="text-xs ios-muted">{buckets.length} 项</span>
        </summary>
        <div className="border-t border-[color:var(--ios-separator)] p-3 pt-2">
          {renderBody()}
        </div>
      </details>
    </>
  );
}

function UsageTrendChart({ buckets }: { buckets: UsageBucketView[] }) {
  const chronological = [...buckets].sort((left, right) => left.key.localeCompare(right.key)).slice(-30);
  const maxCost = Math.max(1, ...chronological.map((bucket) => bucket.costCents));

  return (
    <div className="rounded-lg border border-[color:var(--ios-separator)] bg-white/45 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-stone-950">每日趋势图</h3>
        <span className="text-xs ios-muted">{chronological.length} 天</span>
      </div>
      {chronological.length === 0 ? (
        <p className="py-8 text-center text-sm ios-muted">暂无每日数据</p>
      ) : (
        <div className="grid min-h-40 grid-cols-[repeat(auto-fit,minmax(2rem,1fr))] items-end gap-1.5 sm:min-h-52 sm:grid-cols-[repeat(auto-fit,minmax(2.5rem,1fr))] sm:gap-2">
          {chronological.map((bucket) => {
            const percent = Math.max(7, Math.round((bucket.costCents / maxCost) * 100));
            const dayLabel = bucket.key.slice(5);

            return (
              <div className="grid h-40 grid-rows-[1fr_auto] gap-1.5 sm:h-52 sm:gap-2" key={bucket.key}>
                <div className="flex h-full items-end rounded-lg bg-white/60 px-1.5 py-2">
                  <div
                    aria-label={`${bucket.label} ${formatCents(bucket.costCents)}`}
                    className="w-full rounded-md bg-[color:var(--claude-accent)] shadow-sm"
                    style={{ height: `${percent}%` }}
                    title={`${bucket.label} · ${formatCents(bucket.costCents)} · ${formatNumber(bucket.totalTokens)} tokens`}
                  />
                </div>
                <div className="min-w-0 text-center">
                  <p className="truncate text-xs font-semibold text-stone-900">{dayLabel}</p>
                  <p className="truncate text-[11px] ios-muted">{formatCents(bucket.costCents)}</p>
                  <p className="truncate text-[11px] ios-muted">{formatNumber(bucket.records)} 条</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function UsageRecordMeta({ record }: { record: UsageRecordView }) {
  return (
    <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
      <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-emerald-700">
        {record.surface}
      </span>
      <span className="rounded-md bg-sky-50 px-2 py-0.5 text-sky-700">
        {usageModeLabel(record.mode)}
      </span>
      <span className="rounded-md bg-stone-100 px-2 py-0.5 text-stone-600">
        {usageSourceLabel(record.usageSource)}
      </span>
    </div>
  );
}

function usagePageNumbers(page: number, totalPages: number) {
  const pages: Array<number | string> = [];
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const end = Math.min(totalPages, Math.max(page + 2, 5));

  if (start > 1) {
    pages.push(1);
    if (start > 2) {
      pages.push("start-ellipsis");
    }
  }

  for (let item = start; item <= end; item += 1) {
    pages.push(item);
  }

  if (end < totalPages) {
    if (end < totalPages - 1) {
      pages.push("end-ellipsis");
    }
    pages.push(totalPages);
  }

  return pages;
}

function UsagePaginationControls({
  loading,
  onChangePage,
  onChangePageSize,
  page,
  pageSize,
  totalPages
}: {
  loading: boolean;
  onChangePage: (page: number) => void;
  onChangePageSize: (pageSize: number) => void;
  page: number;
  pageSize: number;
  totalPages: number;
}) {
  const pageNumbers = usagePageNumbers(page, totalPages);

  return (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      <label className="flex shrink-0 items-center gap-2 text-[11px] ios-muted sm:text-xs">
        每页
        <select
          className="ios-select h-9 w-20 bg-white/70 text-sm font-semibold"
          disabled={loading}
          onChange={(event) => onChangePageSize(Number(event.target.value))}
          value={String(pageSize)}
        >
          <option value="10">10</option>
          <option value="20">20</option>
          <option value="50">50</option>
          <option value="100">100</option>
        </select>
      </label>
      <button
        className="ios-button-secondary app-action-button h-9 shrink-0 px-2.5 text-sm disabled:opacity-40 sm:px-3"
        disabled={loading || page <= 1}
        onClick={() => onChangePage(page - 1)}
        type="button"
      >
        上一页
      </button>
      <span className="rounded-lg bg-white/65 px-2.5 py-2 text-xs font-semibold text-stone-700 sm:hidden">
        第 {formatNumber(page)} / {formatNumber(totalPages)} 页
      </span>
      <div className="hidden flex-wrap items-center gap-1 sm:flex">
        {pageNumbers.map((item) =>
          typeof item === "number" ? (
            <button
              className={`app-action-button h-9 min-w-9 rounded-lg px-3 text-sm font-semibold transition disabled:opacity-40 ${
                item === page
                  ? "bg-[color:var(--claude-accent)] text-white shadow-sm"
                  : "ios-button-secondary"
              }`}
              disabled={loading || item === page}
              key={item}
              onClick={() => onChangePage(item)}
              type="button"
            >
              {item}
            </button>
          ) : (
            <span className="px-1 text-xs ios-muted" key={item}>
              ...
            </span>
          )
        )}
      </div>
      <button
        className="ios-button-secondary app-action-button h-9 shrink-0 px-2.5 text-sm disabled:opacity-40 sm:px-3"
        disabled={loading || page >= totalPages}
        onClick={() => onChangePage(page + 1)}
        type="button"
      >
        下一页
      </button>
    </div>
  );
}

function UsageRecordsTable({
  loading,
  onChangePage,
  onChangePageSize,
  pageSize,
  usageBreakdown
}: {
  loading: boolean;
  onChangePage: (page: number) => void;
  onChangePageSize: (pageSize: number) => void;
  pageSize: number;
  usageBreakdown: UsageBreakdownPayload;
}) {
  const records = usageBreakdown.recentRecords;
  const total = usageBreakdown.recordsTotal ?? usageBreakdown.totals.records;
  const limit = usageBreakdown.recordsLimit ?? pageSize;
  const offset = usageBreakdown.recordsOffset ?? 0;
  const page = Math.floor(offset / Math.max(1, limit)) + 1;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  const pageStart = records.length > 0 ? offset + 1 : 0;
  const pageEnd = offset + records.length;

  return (
    <div className="overflow-hidden rounded-lg border border-[color:var(--ios-separator)] bg-white/45">
      <div className="flex flex-col items-stretch gap-3 border-b border-[color:var(--ios-separator)] px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-stone-950">使用日志</h3>
          <p className="mt-1 text-xs ios-muted">
            显示 {formatNumber(pageStart)} - {formatNumber(pageEnd)}，共{" "}
            {formatNumber(total)} 条
          </p>
        </div>
        <UsagePaginationControls
          loading={loading}
          onChangePage={onChangePage}
          onChangePageSize={onChangePageSize}
          page={page}
          pageSize={limit}
          totalPages={totalPages}
        />
      </div>
      {loading ? (
        <div className="grid min-h-40 place-items-center text-stone-500">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : records.length === 0 ? (
        <p className="px-3 py-10 text-center text-sm ios-muted">暂无使用日志。</p>
      ) : (
        <>
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[980px] border-collapse text-left text-sm">
              <thead className="bg-white/75 text-xs text-stone-500">
                <tr>
                  <th className="px-3 py-3 font-semibold">时间 / 来源</th>
                  <th className="px-3 py-3 font-semibold">模型</th>
                  <th className="px-3 py-3 font-semibold">Token 明细</th>
                  <th className="px-3 py-3 font-semibold">请求</th>
                  <th className="px-3 py-3 font-semibold">费用 / 耗时</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--ios-separator)]">
                {records.map((record) => (
                  <tr className="align-top hover:bg-white/60" key={record.id}>
                    <td className="px-3 py-3">
                      <p className="font-semibold text-stone-900">
                        {new Date(record.createdAt).toLocaleString()}
                      </p>
                      <div className="mt-2">
                        <UsageRecordMeta record={record} />
                      </div>
                      {record.apiKeyLabel ? (
                        <p className="mt-2 max-w-56 truncate text-xs ios-muted">{record.apiKeyLabel}</p>
                      ) : record.conversationId ? (
                        <p className="mt-2 max-w-56 truncate text-xs ios-muted">
                          会话 {record.conversationId}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <p className="max-w-56 truncate font-semibold text-stone-900">{record.model}</p>
                      <p className="mt-1 text-xs ios-muted">
                        推理 {reasoningEffortLabel(record.reasoningEffort)} ·{" "}
                        {record.billingMode || "按量"}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <UsageTokenLine
                        cachedPromptTokens={record.cachedPromptTokens}
                        completionTokens={record.completionTokens}
                        promptTokens={record.promptTokens}
                        reasoningTokens={record.reasoningTokens}
                        totalTokens={record.totalTokens}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <p className="max-w-44 truncate font-medium text-stone-900">
                        {record.endpoint || "-"}
                      </p>
                      <p className="mt-1 max-w-44 truncate text-xs ios-muted">
                        {requestKindLabel(record.requestKind)} · {quotaSourceLabel(record.quotaSource)}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <p className="font-semibold text-emerald-700">
                        {formatCents(record.estimatedCostCents)}
                      </p>
                      <p className="mt-1 text-xs ios-muted">
                        总 {formatDuration(record.durationMs)} · 首 token{" "}
                        {formatDuration(record.firstTokenLatencyMs)}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-2 p-3 lg:hidden">
            {records.map((record) => (
              <div
                className="rounded-lg border border-[color:var(--ios-separator)] bg-white/55 p-3"
                key={record.id}
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-stone-950">{record.model}</p>
                    <p className="mt-1 truncate text-xs ios-muted">
                      {new Date(record.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold text-emerald-700">
                    {formatCents(record.estimatedCostCents)}
                  </p>
                </div>
                <UsageRecordMeta record={record} />
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <div className="rounded-lg bg-white/65 px-3 py-2">
                    <UsageTokenLine
                      cachedPromptTokens={record.cachedPromptTokens}
                      completionTokens={record.completionTokens}
                      promptTokens={record.promptTokens}
                      reasoningTokens={record.reasoningTokens}
                      totalTokens={record.totalTokens}
                    />
                  </div>
                  <div className="rounded-lg bg-white/65 px-3 py-2 text-xs ios-muted">
                    <p className="font-semibold text-stone-900">{record.endpoint || "-"}</p>
                    <p className="mt-1">
                      {requestKindLabel(record.requestKind)} · {record.billingMode || "按量"}
                    </p>
                    <p className="mt-1">
                      总 {formatDuration(record.durationMs)} · 首 token{" "}
                      {formatDuration(record.firstTokenLatencyMs)}
                    </p>
                  </div>
                </div>
                {record.apiKeyLabel || record.conversationId ? (
                  <p className="mt-3 truncate text-xs ios-muted">
                    {record.apiKeyLabel || `会话 ${record.conversationId}`}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
          <div className="border-t border-[color:var(--ios-separator)] bg-white/35 px-3 py-3">
            <UsagePaginationControls
              loading={loading}
              onChangePage={onChangePage}
              onChangePageSize={onChangePageSize}
              page={page}
              pageSize={limit}
              totalPages={totalPages}
            />
          </div>
        </>
      )}
    </div>
  );
}

export function DataTab({
  loadingDataLists,
  onRefreshDataLists,
  archivedConversations,
  savingArchivedConversationId,
  onRestoreArchivedConversation,
  onSetDeleteArchivedConversationTarget,
  onExportProfileData,
  onExportUsageCsv,
  onSetDataControlAction,
  usageBreakdown,
  sharedLinks,
  onCopyText,
  onDeleteSharedLink,
  savingSharedLinkId,
  fileLibrary,
  fileLibraryTotal,
  fileLibraryHasMore,
  fileProjectFilter,
  onSetFileProjectFilter,
  projects,
  visibleFileLibrary,
  savingFileId,
  onDeleteFile,
  loadingMoreFiles,
  onLoadMoreFiles,
  loadingUsageRecordsPage,
  onChangeUsageRecordsPage,
  onChangeUsageRecordsPageSize,
  usageRecordsPageSize,
  origin
}: DataTabProps) {
  const usageRecordLimit = usageBreakdown?.recordsLimit ?? usageRecordsPageSize;
  const usageRecordPage = usageBreakdown
    ? Math.floor((usageBreakdown.recordsOffset ?? 0) / Math.max(1, usageRecordLimit)) + 1
    : 1;
  const usageRecordTotalPages = usageBreakdown
    ? Math.max(
        1,
        Math.ceil(
          (usageBreakdown.recordsTotal ?? usageBreakdown.totals.records) /
            Math.max(1, usageRecordLimit)
        )
      )
    : 1;
  const [mobileDataSection, setMobileDataSection] = useState<MobileDataSection>("usage");
  const mobileDataNavItems: MobileDataNavItem[] = [
    {
      count: usageBreakdown?.totals.records ?? 0,
      icon: Database,
      id: "usage",
      label: "用量"
    },
    {
      count: fileLibraryTotal || fileLibrary.length,
      icon: FileIcon,
      id: "files",
      label: "文件"
    },
    {
      count: sharedLinks.length,
      icon: Link2,
      id: "shared",
      label: "分享"
    },
    {
      count: archivedConversations.length,
      icon: Archive,
      id: "archive",
      label: "归档"
    },
    {
      icon: Shield,
      id: "controls",
      label: "控制"
    }
  ];
  const sectionVisibility = (section: MobileDataSection) =>
    mobileDataSection === section ? "block" : "hidden md:block";

  return (
    <div className="grid gap-4">
      <MobileDataSectionNav
        activeSection={mobileDataSection}
        items={mobileDataNavItems}
        onChange={setMobileDataSection}
      />

      <section className={`${sectionVisibility("controls")} ios-panel motion-lift overflow-hidden`}>
        <div className="flex items-center gap-2 border-b border-[color:var(--ios-separator)] px-4 py-4">
          <FolderOpen className="size-4 text-[color:var(--claude-accent)]" />
          <h2 className="text-base font-semibold">数据控制</h2>
        </div>
        <div className="grid grid-cols-2 gap-2 p-3 sm:gap-3 sm:p-4 md:grid-cols-2">
          <button
            className="ios-button-secondary app-action-button flex h-11 items-center justify-center gap-2 px-3 text-sm sm:px-4"
            onClick={onExportProfileData}
            type="button"
          >
            <Download className="size-4" />
            导出我的数据
          </button>
          <button
            className="ios-button-secondary app-action-button flex h-11 items-center justify-center gap-2 px-3 text-sm sm:px-4"
            onClick={() => onSetDataControlAction("archive_chats")}
            type="button"
          >
            <Archive className="size-4" />
            归档所有聊天
          </button>
          <button
            className="ios-button-secondary app-action-button flex h-11 items-center justify-center gap-2 px-3 text-sm text-red-600 sm:px-4"
            onClick={() => onSetDataControlAction("delete_chats")}
            type="button"
          >
            <Trash2 className="size-4" />
            清空所有聊天
          </button>
          <button
            className="ios-button-secondary app-action-button flex h-11 items-center justify-center gap-2 px-3 text-sm text-red-600 sm:px-4"
            onClick={() => onSetDataControlAction("deactivate_account")}
            type="button"
          >
            <Shield className="size-4" />
            停用账号
          </button>
          <button
            className="ios-button-secondary app-action-button col-span-2 flex h-11 items-center justify-center gap-2 px-3 text-sm text-red-700 sm:px-4 md:col-span-1"
            onClick={() => onSetDataControlAction("delete_account")}
            type="button"
          >
            <Trash2 className="size-4" />
            删除账号
          </button>
        </div>
      </section>

      <section className={`${sectionVisibility("archive")} ios-panel motion-lift overflow-hidden`}>
        <div className="flex flex-col items-stretch gap-3 border-b border-[color:var(--ios-separator)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Archive className="size-4 text-[color:var(--claude-accent)]" />
            <div>
              <h2 className="text-base font-semibold">已归档聊天</h2>
              <p className="mt-1 text-xs ios-muted">
                {archivedConversations.length} 个聊天已从默认历史列表隐藏。
              </p>
            </div>
          </div>
          <button
            className="ios-button-secondary app-action-button flex h-9 items-center gap-2 px-3 text-sm disabled:opacity-60"
            disabled={loadingDataLists}
            onClick={onRefreshDataLists}
            type="button"
          >
            <RotateCcw className="size-4" />
            刷新
          </button>
        </div>
        <div className="grid gap-2 p-4">
          {loadingDataLists ? (
            <div className="grid min-h-20 place-items-center text-stone-500">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : archivedConversations.length === 0 ? (
            <div className="rounded-lg bg-white/45 px-3 py-8 text-center text-sm ios-muted">
              暂无已归档聊天。
            </div>
          ) : (
            archivedConversations.map((conversation) => (
              <div
                className="grid gap-3 rounded-lg border border-[color:var(--ios-separator)] bg-white/55 p-3 md:grid-cols-[1fr_auto]"
                key={conversation.id}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-stone-950">
                    {conversation.title}
                  </p>
                  <p className="mt-1 text-xs ios-muted">
                    {conversation.projectName ? `项目：${conversation.projectName} · ` : ""}
                    {conversation.mode === "IMAGE" ? "图片" : "聊天"} · {conversation.model} ·{" "}
                    {conversation._count?.messages ?? 0} 条消息
                  </p>
                  <p className="mt-1 text-xs ios-muted">
                    归档 {conversation.archivedAt ? new Date(conversation.archivedAt).toLocaleString() : "未知时间"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 md:justify-end">
                  <button
                    className="ios-button-secondary app-action-button flex h-9 items-center gap-2 px-3 text-sm disabled:opacity-60"
                    disabled={savingArchivedConversationId === conversation.id}
                    onClick={() => onRestoreArchivedConversation(conversation.id)}
                    type="button"
                  >
                    <RotateCcw className="size-4" />
                    恢复
                  </button>
                  <button
                    className="ios-icon-button app-action-button text-red-600 disabled:opacity-60"
                    disabled={savingArchivedConversationId === conversation.id}
                    onClick={() => onSetDeleteArchivedConversationTarget(conversation)}
                    title="删除归档聊天"
                    type="button"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className={`${sectionVisibility("usage")} ios-panel motion-lift overflow-hidden`}>
        <div className="flex flex-col items-stretch gap-3 border-b border-[color:var(--ios-separator)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Database className="size-4 text-[color:var(--claude-accent)]" />
            <h2 className="text-base font-semibold">用量与账单</h2>
          </div>
          <button
            className="ios-button-secondary app-action-button flex h-9 items-center gap-2 px-3 text-sm"
            onClick={onExportUsageCsv}
            type="button"
          >
            <Download className="size-4" />
            导出 CSV
          </button>
        </div>
        <div className="grid gap-4 p-4">
          {loadingDataLists ? (
            <div className="grid min-h-20 place-items-center text-stone-500">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : !usageBreakdown ? (
            <div className="rounded-lg bg-white/45 px-3 py-8 text-center text-sm ios-muted">
              暂无用量明细。
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg bg-white/55 p-2.5 sm:p-3">
                  <p className="text-xs ios-muted">记录数</p>
                  <p className="mt-1 text-base font-semibold sm:text-lg">
                    {formatNumber(usageBreakdown.totals.records)}
                  </p>
                  <p className="mt-1 text-xs ios-muted">
                    第 {formatNumber(usageRecordPage)} / {formatNumber(usageRecordTotalPages)} 页
                  </p>
                </div>
                <div className="rounded-lg bg-white/55 p-2.5 sm:p-3">
                  <p className="text-xs ios-muted">Token 总量</p>
                  <p className="mt-1 text-base font-semibold sm:text-lg">
                    {formatNumber(usageBreakdown.totals.totalTokens)}
                  </p>
                  <p className="mt-1 text-xs ios-muted">
                    上行 {formatNumber(usageBreakdown.totals.promptTokens ?? 0)} · 下行{" "}
                    {formatNumber(usageBreakdown.totals.completionTokens ?? 0)}
                  </p>
                </div>
                <div className="rounded-lg bg-white/55 p-2.5 sm:p-3">
                  <p className="text-xs ios-muted">缓存与推理</p>
                  <p className="mt-1 text-base font-semibold sm:text-lg">
                    {formatPercent(usageBreakdown.totals.cacheRate ?? 0)}
                  </p>
                  <p className="mt-1 text-xs ios-muted">
                    缓存 {formatNumber(usageBreakdown.totals.cachedPromptTokens ?? 0)} · 推理{" "}
                    {formatNumber(usageBreakdown.totals.reasoningTokens ?? 0)}
                  </p>
                </div>
                <div className="rounded-lg bg-white/55 p-2.5 sm:p-3">
                  <p className="text-xs ios-muted">估算费用</p>
                  <p className="mt-1 text-base font-semibold sm:text-lg">
                    {formatCents(usageBreakdown.totals.costCents)}
                  </p>
                  <p className="mt-1 text-xs ios-muted">
                    全部记录汇总
                  </p>
                </div>
              </div>

              <UsageTrendChart buckets={usageBreakdown.byDay} />

              <div className="grid gap-3 lg:grid-cols-2">
                <UsageBucketList buckets={usageBreakdown.byModel} defaultOpen title="按模型" />
                <UsageBucketList buckets={usageBreakdown.bySurface} title="按聊天 / API / 图片" />
                <UsageBucketList buckets={usageBreakdown.byApiKey ?? []} title="按 API Key" />
                <UsageBucketList buckets={usageBreakdown.byMode} title="按聊天 / 图片" />
                <UsageBucketList buckets={usageBreakdown.byDay} title="日度明细" />
              </div>

              <UsageRecordsTable
                loading={loadingUsageRecordsPage}
                onChangePage={onChangeUsageRecordsPage}
                onChangePageSize={onChangeUsageRecordsPageSize}
                pageSize={usageRecordsPageSize}
                usageBreakdown={usageBreakdown}
              />
            </>
          )}
        </div>
      </section>

      <section className={`${sectionVisibility("shared")} ios-panel motion-lift overflow-hidden`}>
        <div className="flex flex-col items-stretch gap-3 border-b border-[color:var(--ios-separator)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Link2 className="size-4 text-[color:var(--claude-accent)]" />
            <h2 className="text-base font-semibold">共享链接</h2>
          </div>
          {sharedLinks.length > 0 ? (
            <button
              className="ios-button-secondary app-action-button flex h-9 items-center gap-2 px-3 text-sm text-red-600"
              onClick={() => onSetDataControlAction("clear_shared_links")}
              type="button"
            >
              <Trash2 className="size-4" />
              全部失效
            </button>
          ) : null}
        </div>
        <div className="grid gap-2 p-4">
          {loadingDataLists ? (
            <div className="grid min-h-20 place-items-center text-stone-500">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : sharedLinks.length === 0 ? (
            <div className="rounded-lg bg-white/45 px-3 py-8 text-center text-sm ios-muted">
              暂无共享链接。
            </div>
          ) : (
            sharedLinks.map((link) => (
              <div
                className="grid gap-3 rounded-lg border border-[color:var(--ios-separator)] bg-white/55 p-3 md:grid-cols-[1fr_auto]"
                key={link.id}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-stone-950">{link.title}</p>
                  <p className="mt-1 text-xs ios-muted">
                    {link.model} · 创建 {new Date(link.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 md:justify-end">
                  <button
                    className="ios-button-secondary app-action-button flex h-9 items-center gap-2 px-3 text-sm"
                    onClick={() => onCopyText(`${origin}/share/${link.token}`, "共享链接已复制。")}
                    type="button"
                  >
                    <Copy className="size-4" />
                    复制
                  </button>
                  <button
                    className="ios-icon-button app-action-button text-red-600 disabled:opacity-60"
                    disabled={savingSharedLinkId === link.id}
                    onClick={() => onDeleteSharedLink(link.id)}
                    title="取消分享"
                    type="button"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className={`${sectionVisibility("files")} ios-panel motion-lift overflow-hidden`}>
        <div className="flex flex-col items-stretch gap-3 border-b border-[color:var(--ios-separator)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <FileIcon className="size-4 text-[color:var(--claude-accent)]" />
            <div>
              <h2 className="text-base font-semibold">文件库</h2>
              <p className="mt-1 text-xs ios-muted">
                {visibleFileLibrary.length} / {fileLibraryTotal || fileLibrary.length} 个文件
              </p>
            </div>
          </div>
          <select
            className="ios-input h-9 w-full bg-white/72 px-3 text-sm font-semibold sm:w-auto"
            onChange={(event) => onSetFileProjectFilter(event.target.value)}
            title="按项目筛选文件"
            value={fileProjectFilter}
          >
            <option value="">全部文件</option>
            <option value="__account__">账号默认</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-2 p-4">
          {loadingDataLists ? (
            <div className="grid min-h-20 place-items-center text-stone-500">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : visibleFileLibrary.length === 0 ? (
            <div className="rounded-lg bg-white/45 px-3 py-8 text-center text-sm ios-muted">
              {fileLibrary.length === 0 ? "暂无上传文件。" : "当前筛选下没有文件。"}
            </div>
          ) : (
            visibleFileLibrary.map((file) => (
              <div
                className="grid gap-3 rounded-lg border border-[color:var(--ios-separator)] bg-white/55 p-3 md:grid-cols-[1fr_auto]"
                key={file.id}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-stone-950">{file.originalName}</p>
                  <p className="mt-1 text-xs ios-muted">
                    {file.kind} · {formatBytes(file.sizeBytes)} · {file.temporary ? "临时文件" : file.projectName ? `项目文件：${file.projectName}` : "账号文件"} · {file.conversationTitle || "未关联聊天"}
                  </p>
                </div>
                <button
                  className="ios-icon-button app-action-button text-red-600 disabled:opacity-60 md:justify-self-end"
                  disabled={savingFileId === file.id}
                  onClick={() => onDeleteFile(file.id)}
                  title="删除文件"
                  type="button"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))
          )}
          {!loadingDataLists && fileLibraryHasMore ? (
            <button
              className="ios-button-secondary app-action-button mx-auto mt-2 flex h-9 items-center gap-2 px-3 text-sm disabled:opacity-60"
              disabled={loadingMoreFiles}
              onClick={onLoadMoreFiles}
              type="button"
            >
              {loadingMoreFiles ? <Loader2 className="size-4 animate-spin" /> : <Archive className="size-4" />}
              加载更多文件
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
