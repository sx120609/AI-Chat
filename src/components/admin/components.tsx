import {
  Activity,
  Globe2,
  SlidersHorizontal,
  MessageSquareText,
  Code2,
  Mail,
  CreditCard,
  UserCog
} from "lucide-react";
import { formatNumber } from "@/lib/format";
import {
  DEFAULT_IMAGE_UPSTREAM_MODEL,
  DEFAULT_UPSTREAM_MODEL_MAP,
  DEFAULT_REASONING_EFFORT,
  DEFAULT_REASONING_PARAM_MODE,
  DEFAULT_CONTEXT_COMPRESSION_ENABLED,
  DEFAULT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT,
  DEFAULT_LONG_CONTEXT_THRESHOLD_TOKENS
} from "@/lib/models";
import type { AdminUsageRecordView } from "@/types/gateway";
import type {
  AdminTab,
  DiagnosticsResult,
  DiagnosticCheck,
  CreateForm,
  SettingsForm,
  UsageFilterState
} from "./types";

export const defaultUsageFilters: UsageFilterState = {
  apiKey: "all",
  days: "7",
  model: "all",
  page: "1",
  pageSize: "20",
  query: "",
  surface: "all",
  userId: "all"
};

export const emptyForm: CreateForm = {
  email: "",
  name: "",
  password: "",
  role: "USER",
  userGroup: "NORMAL",
  monthlyCostLimitCents: 5000
};

export const emptySettings: SettingsForm = {
  siteName: "Team AI Gateway",
  siteUrl: "",
  apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "",
  orgId: "",
  mockResponses: false,
  clearApiKey: false,
  chatModelMap: DEFAULT_UPSTREAM_MODEL_MAP,
  chatModelDisplay: {},
  enabledChatModelIds: [],
  imageModelId: DEFAULT_IMAGE_UPSTREAM_MODEL,
  defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
  reasoningParamMode: DEFAULT_REASONING_PARAM_MODE,
  contextCompressionEnabled: DEFAULT_CONTEXT_COMPRESSION_ENABLED,
  contextCompressionThresholdPercent: DEFAULT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT,
  longContextThresholdTokens: DEFAULT_LONG_CONTEXT_THRESHOLD_TOKENS,
  systemPromptMode: "default",
  customSystemPrompt: "",
  modelSystemPrompts: {},
  codeInterpreterEnabled: false,
  codeInterpreterSandbox: "docker",
  codeInterpreterAllowPackageInstall: false,
  codeInterpreterPipIndexUrl: "https://pypi.org/simple",
  webSearchEnabled: false,
  webSearchProvider: "duckduckgo",
  webSearchMaxResults: 5,
  registrationEnabled: false,
  registrationRequireEmailVerification: false,
  registrationDefaultCostLimitCents: 5000,
  smtpEnabled: false,
  smtpHost: "",
  smtpPort: 587,
  smtpUsername: "",
  smtpPassword: "",
  clearSmtpPassword: false,
  smtpFromEmail: "",
  smtpFromName: "",
  smtpSecure: false,
  smtpStartTls: true,
  easyPayEnabled: false,
  easyPayAllowRefund: false,
  easyPayDisplayMode: "qrcode",
  easyPayMethods: ["alipay", "wxpay"],
  easyPayBalanceCentsPerYuan: 100,
  easyPayPid: "",
  easyPayKey: "",
  clearEasyPayKey: false,
  easyPayApiBaseUrl: "",
  easyPayAlipayChannelId: "",
  easyPayWxpayChannelId: ""
};

export const adminTabs: Array<{
  id: AdminTab;
  label: string;
  description: string;
  icon: typeof Globe2;
}> = [
  {
    id: "access",
    label: "接入",
    description: "站点、API、推理与上下文",
    icon: Globe2
  },
  {
    id: "models",
    label: "模型",
    description: "映射、展示与启用",
    icon: SlidersHorizontal
  },
  {
    id: "prompts",
    label: "提示词",
    description: "全局和模型专属身份",
    icon: MessageSquareText
  },
  {
    id: "tools",
    label: "工具",
    description: "代码配置与联网搜索",
    icon: Code2
  },
  {
    id: "mail",
    label: "邮件",
    description: "SMTP、STARTTLS 与测试",
    icon: Mail
  },
  {
    id: "payment",
    label: "支付",
    description: "易支付与充值",
    icon: CreditCard
  },
  {
    id: "users",
    label: "用户",
    description: "注册、余额与账号",
    icon: UserCog
  },
  {
    id: "usage",
    label: "用量",
    description: "聊天与 API Token",
    icon: Activity
  }
];

export function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit"
  });
}

export function paginationPages(page: number, totalPages: number) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages: Array<number | string> = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);

  if (start > 2) {
    pages.push("ellipsis-start");
  }

  for (let current = start; current <= end; current += 1) {
    pages.push(current);
  }

  if (end < totalPages - 1) {
    pages.push("ellipsis-end");
  }

  pages.push(totalPages);
  return pages;
}

export function compactTokenCount(tokens: number) {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 1 : 2)}M`;
  }

  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(tokens >= 10_000 ? 1 : 2)}K`;
  }

  return formatNumber(tokens);
}

export function formatDuration(value: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  if (value < 1000) {
    return `${Math.max(0, Math.round(value))}ms`;
  }

  return `${(value / 1000).toFixed(value < 10_000 ? 2 : 1)}s`;
}

export function formatPercent(value: number) {
  return `${Math.round(value * 1000) / 10}%`;
}

export function requestKindLabel(kind: string) {
  if (kind === "stream") {
    return "流式";
  }

  if (kind === "sync") {
    return "同步";
  }

  return "-";
}

export function reasoningEffortLabel(value: string) {
  if (!value) {
    return "-";
  }

  const labels: Record<string, string> = {
    high: "High",
    low: "Low",
    medium: "Medium",
    xhigh: "XHigh"
  };

  return labels[value] || value;
}

export function usageKindTone(kind: string) {
  if (kind === "stream") {
    return "bg-blue-50 text-blue-700";
  }

  if (kind === "sync") {
    return "bg-slate-100 text-slate-700";
  }

  return "bg-stone-100 text-stone-600";
}

export function usageSurfaceTone(surface: string) {
  if (surface === "个人 API") {
    return "bg-indigo-50 text-indigo-700";
  }

  if (surface === "聊天") {
    return "bg-emerald-50 text-emerald-700";
  }

  if (surface === "图片") {
    return "bg-amber-50 text-amber-700";
  }

  return "bg-slate-100 text-slate-600";
}

export function usageRecordTitle(record: AdminUsageRecordView) {
  if (record.conversationTitle) {
    return record.conversationTitle;
  }

  if (record.apiKeyLabel) {
    return record.apiKeyLabel;
  }

  return record.conversationId ? `会话 ${record.conversationId}` : record.sourceLabel;
}

export function DiagnosticsPanel({ result }: { result: DiagnosticsResult }) {
  const tone = {
    ok: "border-green-200 bg-green-50 text-green-800",
    warn: "border-amber-200 bg-amber-50 text-amber-800",
    error: "border-red-200 bg-red-50 text-red-700"
  } satisfies Record<DiagnosticCheck["status"], string>;

  return (
    <section className="ios-panel motion-lift mb-4 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Sub2API 连接诊断</h2>
          <p className="mt-1 text-xs ios-muted">
            {result.modelCount} 个模型 · {result.chatModelCount} 个聊天候选
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            result.ok ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
          }`}
        >
          {result.ok ? "可用" : "需检查"}
        </span>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {result.checks.map((check) => (
          <div className={`app-list-row rounded-lg border px-3 py-2 text-sm ${tone[check.status]}`} key={check.name}>
            <p className="font-semibold">{check.name}</p>
            <p className="mt-1 text-xs leading-5">{check.message}</p>
          </div>
        ))}
      </div>
      {result.sample.length > 0 ? (
        <p className="mt-3 break-words text-xs ios-muted">样例模型：{result.sample.join(", ")}</p>
      ) : null}
    </section>
  );
}

export function CostLimitInput({
  className = "ios-input h-9 w-32 text-sm",
  onChange,
  placeholder,
  value
}: {
  className?: string;
  onChange: (value: number) => void;
  placeholder?: string;
  value: number;
}) {
  return (
    <input
      className={className}
      min={0.01}
      onChange={(event) => {
        const dollars = Number(event.target.value);

        if (!Number.isFinite(dollars)) {
          return;
        }

        onChange(Math.max(1, Math.round(dollars * 100)));
      }}
      placeholder={placeholder}
      step={0.01}
      type="number"
      value={value / 100}
    />
  );
}
