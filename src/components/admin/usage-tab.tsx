import { Loader2, RefreshCw, Activity } from "lucide-react";
import { formatCents, formatNumber } from "@/lib/format";
import type {
  AdminUsageFilterOptionsView,
  AdminUsageRecordView,
  AdminUsageSummaryView
} from "@/types/gateway";
import {
  formatDateTime,
  paginationPages,
  compactTokenCount,
  formatDuration,
  formatPercent,
  requestKindLabel,
  reasoningEffortLabel,
  usageKindTone,
  usageSurfaceTone,
  usageRecordTitle
} from "./components";
import type { UsageFilterState } from "./types";

type UsageTabProps = {
  filters: UsageFilterState;
  generatedAt: string;
  loading: boolean;
  onChangePage: (page: number) => void;
  onChangePageSize: (pageSize: string) => void;
  onExportCsv: () => void;
  onRefresh: () => void;
  onReset: () => void;
  onUpdateFilters: (patch: Partial<UsageFilterState>) => void;
  options: AdminUsageFilterOptionsView;
  pageMeta: { page: number; pageSize: number; totalPages: number };
  records: AdminUsageRecordView[];
  summary: AdminUsageSummaryView | null;
};

function UsageMetricCard({
  detail,
  label,
  value
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <div className="app-list-row rounded-lg border border-[color:var(--ios-separator)] bg-white/60 px-4 py-3">
      <p className="text-xs font-medium ios-muted">{label}</p>
      <p className="mt-1 truncate text-2xl font-semibold text-slate-900">{value}</p>
      <p className="mt-1 line-clamp-2 text-xs ios-muted">{detail}</p>
    </div>
  );
}

function UsageMiniBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/60 px-3 py-2">
      <p className="ios-muted">{label}</p>
      <p className="mt-1 truncate font-semibold text-slate-800">{value}</p>
    </div>
  );
}

function UsageTokenBreakdown({ record }: { record: AdminUsageRecordView }) {
  return (
    <div className="space-y-1 text-xs ios-muted">
      <p className="font-semibold text-slate-800">总计 {formatNumber(record.totalTokens)}</p>
      <p>
        <span className="text-emerald-600">↓</span> {formatNumber(record.promptTokens)} ·{" "}
        <span className="text-violet-600">↑</span> {formatNumber(record.completionTokens)}
      </p>
      {record.cachedPromptTokens > 0 || record.reasoningTokens > 0 ? (
        <p>
          缓存 {formatNumber(record.cachedPromptTokens)} · 推理 {formatNumber(record.reasoningTokens)}
        </p>
      ) : null}
    </div>
  );
}

function UsagePagination({
  end,
  loading,
  onChangePage,
  onChangePageSize,
  page,
  pageNumbers,
  pageSize,
  start,
  total,
  totalPages
}: {
  end: number;
  loading: boolean;
  onChangePage: (page: number) => void;
  onChangePageSize: (pageSize: string) => void;
  page: number;
  pageNumbers: Array<number | string>;
  pageSize: number;
  start: number;
  total: number;
  totalPages: number;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-[color:var(--ios-separator)] bg-white/45 px-4 py-3 text-sm md:flex-row md:items-center md:justify-between">
      <div className="flex flex-wrap items-center gap-2 text-xs ios-muted">
        <span>
          显示 {formatNumber(start)} 至 {formatNumber(end)}，共 {formatNumber(total)} 条
        </span>
        <label className="flex items-center gap-2">
          每页
          <select
            className="ios-select h-9 w-24 text-sm"
            disabled={loading}
            onChange={(event) => onChangePageSize(event.target.value)}
            value={String(pageSize)}
          >
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <button
          className="ios-button-secondary app-action-button h-9 px-3 text-sm disabled:opacity-40"
          disabled={loading || page <= 1}
          onClick={() => onChangePage(page - 1)}
          type="button"
        >
          上一页
        </button>
        {pageNumbers.map((item) =>
          typeof item === "number" ? (
            <button
              className={`app-action-button h-9 min-w-9 rounded-lg px-3 text-sm font-semibold ${
                item === page
                  ? "bg-[color:var(--claude-accent)] text-white"
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
            <span className="grid h-9 min-w-8 place-items-center text-sm ios-muted" key={item}>
              ...
            </span>
          )
        )}
        <button
          className="ios-button-secondary app-action-button h-9 px-3 text-sm disabled:opacity-40"
          disabled={loading || page >= totalPages}
          onClick={() => onChangePage(page + 1)}
          type="button"
        >
          下一页
        </button>
      </div>
    </div>
  );
}

export function UsageTab({
  filters,
  generatedAt,
  loading,
  onChangePage,
  onChangePageSize,
  onExportCsv,
  onRefresh,
  onReset,
  onUpdateFilters,
  options,
  pageMeta,
  records,
  summary
}: UsageTabProps) {
  const recordCount = summary?.records ?? records.length;
  const returnedRecords = summary?.returnedRecords ?? records.length;
  const pageStart = records.length > 0 ? (pageMeta.page - 1) * pageMeta.pageSize + 1 : 0;
  const pageEnd = records.length > 0 ? pageStart + records.length - 1 : 0;
  const pageNumbers = paginationPages(pageMeta.page, pageMeta.totalPages);

  return (
    <section className="ios-panel motion-lift mb-5 overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-[color:var(--ios-separator)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div className="grid size-9 place-items-center rounded-lg bg-[color:var(--app-accent-soft)] text-[color:var(--claude-accent)]">
            <Activity className="size-4" />
          </div>
          <div>
            <h2 className="text-base font-semibold">使用记录</h2>
            <p className="text-xs ios-muted">
              显示 {formatNumber(returnedRecords)} / {formatNumber(recordCount)} 条 · 更新{" "}
              {generatedAt ? formatDateTime(generatedAt) : "未加载"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="ios-button-secondary app-action-button flex h-9 items-center justify-center gap-2 px-3 text-sm disabled:opacity-50"
            disabled={loading}
            onClick={onRefresh}
            type="button"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            刷新
          </button>
          <button
            className="ios-button-secondary app-action-button flex h-9 items-center justify-center gap-2 px-3 text-sm disabled:opacity-50"
            disabled={loading}
            onClick={onReset}
            type="button"
          >
            重置
          </button>
          <button
            className="ios-button-primary app-action-button flex h-9 items-center justify-center gap-2 px-3 text-sm disabled:opacity-50"
            disabled={loading || recordCount === 0}
            onClick={onExportCsv}
            type="button"
          >
            导出 CSV
          </button>
        </div>
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
        <UsageMetricCard
          detail={`所选范围内 · 聊天 ${formatNumber(summary?.chatCalls ?? 0)} · API ${formatNumber(summary?.apiCalls ?? 0)}`}
          label="总请求数"
          value={formatNumber(recordCount)}
        />
        <UsageMetricCard
          detail={`输入 ${formatNumber(summary?.promptTokens ?? 0)} · 输出 ${formatNumber(summary?.completionTokens ?? 0)} · 缓存 ${formatNumber(summary?.cachedPromptTokens ?? 0)}`}
          label="总 Token"
          value={compactTokenCount(summary?.totalTokens ?? 0)}
        />
        <UsageMetricCard
          detail={`缓存命中率 ${formatPercent(summary?.cacheRate ?? 0)} · 推理 ${formatNumber(summary?.reasoningTokens ?? 0)}`}
          label="总消费"
          value={formatCents(summary?.costCents ?? 0)}
        />
        <UsageMetricCard
          detail={`首 token ${formatDuration(summary?.avgFirstTokenLatencyMs ?? null)} · 图片 ${formatNumber(summary?.imageCalls ?? 0)} · 任务 ${formatNumber(summary?.taskCalls ?? 0)}`}
          label="平均耗时"
          value={formatDuration(summary?.avgDurationMs ?? null)}
        />
      </div>

      <div className="border-y border-[color:var(--ios-separator)] bg-white/35 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <label className="block">
            <span className="mb-1 block text-xs font-medium ios-muted">API 密钥</span>
            <select
              className="ios-select h-10 w-full text-sm"
              onChange={(event) => onUpdateFilters({ apiKey: event.target.value })}
              value={filters.apiKey}
            >
              <option value="all">全部密钥</option>
              {options.apiKeys.map((apiKey) => (
                <option key={apiKey.id} value={apiKey.id}>
                  {apiKey.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium ios-muted">时间范围</span>
            <select
              className="ios-select h-10 w-full text-sm"
              onChange={(event) => onUpdateFilters({ days: event.target.value })}
              value={filters.days}
            >
              <option value="1">近 24 小时</option>
              <option value="7">近 7 天</option>
              <option value="30">近 30 天</option>
              <option value="90">近 90 天</option>
              <option value="all">全部时间</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium ios-muted">来源</span>
            <select
              className="ios-select h-10 w-full text-sm"
              onChange={(event) => onUpdateFilters({ surface: event.target.value })}
              value={filters.surface}
            >
              <option value="all">全部来源</option>
              <option value="chat">聊天</option>
              <option value="api">个人 API</option>
              <option value="image">图片</option>
              <option value="task">任务</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium ios-muted">用户</span>
            <select
              className="ios-select h-10 w-full text-sm"
              onChange={(event) => onUpdateFilters({ userId: event.target.value })}
              value={filters.userId}
            >
              <option value="all">全部用户</option>
              {options.users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium ios-muted">模型</span>
            <select
              className="ios-select h-10 w-full text-sm"
              onChange={(event) => onUpdateFilters({ model: event.target.value })}
              value={filters.model}
            >
              <option value="all">全部模型</option>
              {options.models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium ios-muted">搜索</span>
            <input
              className="ios-input h-10 w-full text-sm"
              onChange={(event) => onUpdateFilters({ query: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  onRefresh();
                }
              }}
              placeholder="用户、模型、端点、UA"
              value={filters.query}
            />
          </label>
        </div>
      </div>

      {loading ? (
        <div className="app-loading-pulse grid min-h-64 place-items-center text-slate-500">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : records.length > 0 ? (
        <>
          <div className="hidden overflow-x-auto md:block" aria-label="使用记录表格横向滚动区域">
            <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
              <thead className="sticky top-0 z-10 bg-white/90 text-xs text-slate-500 backdrop-blur">
                <tr>
                  <th className="px-4 py-3 font-semibold">API 密钥 / 用户</th>
                  <th className="px-4 py-3 font-semibold">模型</th>
                  <th className="px-4 py-3 font-semibold">端点 / 类型</th>
                  <th className="px-4 py-3 font-semibold">Token</th>
                  <th className="px-4 py-3 font-semibold">费用</th>
                  <th className="px-4 py-3 font-semibold">耗时</th>
                  <th className="px-4 py-3 font-semibold">时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--ios-separator)]">
                {records.map((record) => (
                  <tr className="app-table-row align-top" key={record.id}>
                    <td className="px-4 py-3">
                      <p className="max-w-52 truncate font-semibold text-slate-900">
                        {record.apiKeyLabel || usageRecordTitle(record)}
                      </p>
                      <p className="mt-1 max-w-52 truncate text-xs ios-muted">
                        {record.userName} · {record.userEmail}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="max-w-44 truncate font-semibold text-slate-800">{record.model}</p>
                      <p className="mt-1 text-xs ios-muted">
                        {record.mode === "IMAGE" ? "图片" : "聊天"} · 推理 {reasoningEffortLabel(record.reasoningEffort)}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="max-w-44 truncate font-medium text-slate-800">{record.endpoint || "-"}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${usageKindTone(record.requestKind)}`}>
                          {requestKindLabel(record.requestKind)}
                        </span>
                        <span className="rounded-md bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
                          {record.billingMode || "按量"}
                        </span>
                      </div>
                      <p className="mt-1 max-w-44 truncate text-xs ios-muted">{record.sourceLabel}</p>
                    </td>
                    <td className="px-4 py-3">
                      <UsageTokenBreakdown record={record} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-semibold text-emerald-700">
                      {formatCents(record.estimatedCostCents)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                      <p className="font-medium">{formatDuration(record.durationMs ?? null)}</p>
                      <p className="mt-1 text-xs ios-muted">首 {formatDuration(record.firstTokenLatencyMs ?? null)}</p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                      <p>{formatDateTime(record.createdAt)}</p>
                      <p className="mt-1 max-w-36 truncate" title={record.userAgent || undefined}>
                        {record.userAgent || "-"}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 p-3 md:hidden">
            {records.map((record) => (
              <div
                className="app-list-row rounded-lg border border-[color:var(--ios-separator)] bg-white/55 p-3"
                key={record.id}
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {record.apiKeyLabel || usageRecordTitle(record)}
                    </p>
                    <p className="mt-1 truncate text-xs ios-muted">
                      {record.model} · {formatDateTime(record.createdAt)}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${usageSurfaceTone(record.surface)}`}>
                    {record.surface}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <UsageMiniBlock label="端点" value={record.endpoint || "-"} />
                  <UsageMiniBlock label="费用" value={formatCents(record.estimatedCostCents)} />
                  <UsageMiniBlock label="首 token" value={formatDuration(record.firstTokenLatencyMs ?? null)} />
                  <UsageMiniBlock label="耗时" value={formatDuration(record.durationMs ?? null)} />
                  <div className="col-span-2 rounded-lg bg-white/60 px-3 py-2">
                    <UsageTokenBreakdown record={record} />
                  </div>
                </div>
                <p className="mt-3 truncate text-xs ios-muted">
                  {record.userName} · {record.userAgent || record.sourceLabel}
                </p>
              </div>
            ))}
          </div>
          <UsagePagination
            end={pageEnd}
            loading={loading}
            onChangePage={onChangePage}
            onChangePageSize={onChangePageSize}
            page={pageMeta.page}
            pageNumbers={pageNumbers}
            pageSize={pageMeta.pageSize}
            start={pageStart}
            total={recordCount}
            totalPages={pageMeta.totalPages}
          />
        </>
      ) : (
        <div className="grid min-h-48 place-items-center px-4 py-8 text-sm ios-muted">
          暂无用量记录
        </div>
      )}
    </section>
  );
}
