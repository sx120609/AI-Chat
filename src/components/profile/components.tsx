import {
  BaseStyle,
  ChatPersonality,
  PersonalizationLevel
} from "@/lib/personalization";
import {
  UserRound,
  Sparkles,
  Database,
  FolderOpen,
  Lock,
  KeyRound,
  Terminal,
  FileCode2,
  Braces
} from "lucide-react";
import {
  ProfileTab,
  SelectOption,
  InstructionPreset,
  ApiGuideTool,
  ApiGuideOs
} from "./types";

export function groupLabel(group: string) {
  return group === "VIP" ? "VIP" : "普通";
}

export function memorySourceLabel(source: string) {
  return source === "chat" ? "聊天保存" : "手动添加";
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const BASE_STYLE_OPTIONS: SelectOption<BaseStyle>[] = [
  { label: "默认", value: "default" },
  { label: "简洁直接", value: "concise" },
  { label: "均衡", value: "balanced" },
  { label: "详细深入", value: "detailed" }
];

export const PERSONALITY_OPTIONS: SelectOption<ChatPersonality>[] = [
  { label: "默认", value: "default" },
  { label: "友好", value: "friendly" },
  { label: "直接", value: "direct" },
  { label: "鼓励型", value: "encouraging" },
  { label: "专业型", value: "professional" }
];

export const LEVEL_OPTIONS: SelectOption<PersonalizationLevel>[] = [
  { label: "默认", value: "default" },
  { label: "少一点", value: "low" },
  { label: "适中", value: "medium" },
  { label: "更多", value: "high" }
];

export const INSTRUCTION_PRESETS: Array<{
  id: InstructionPreset;
  label: string;
  description: string;
}> = [
  { id: "concise", label: "简洁", description: "先给结论，少铺垫。" },
  { id: "professional", label: "专业", description: "准确、稳健、少口语。" },
  { id: "teaching", label: "教学", description: "分步骤解释原因。" },
  { id: "code", label: "代码助手", description: "重视实现、验证和边界。" },
  { id: "life", label: "生活助理", description: "自然体贴，适合日常决策。" }
];

export const profileTabs: Array<{
  id: ProfileTab;
  label: string;
  description: string;
  icon: typeof UserRound;
}> = [
  {
    id: "overview",
    label: "资料",
    description: "身份、邮箱与额度",
    icon: UserRound
  },
  {
    id: "security",
    label: "安全",
    description: "密码、设备与活动",
    icon: Lock
  },
  {
    id: "personalization",
    label: "个性化",
    description: "指令、语调与人格",
    icon: Sparkles
  },
  {
    id: "memory",
    label: "记忆",
    description: "保存、引用与归档",
    icon: Database
  },
  {
    id: "data",
    label: "数据",
    description: "导出、文件与分享",
    icon: FolderOpen
  },
  {
    id: "api",
    label: "个人 API",
    description: "模型、Base URL 与 Key",
    icon: KeyRound
  }
];

export const apiGuideTools: Array<{
  id: ApiGuideTool;
  label: string;
  description: string;
  hint: string;
  icon: typeof Terminal;
}> = [
  {
    id: "codex",
    label: "Codex CLI",
    description: "Responses API",
    hint: "适合 Codex CLI，使用独立 LOWIQ_API_KEY，不占用 OPENAI_API_KEY。",
    icon: Terminal
  },
  {
    id: "opencode",
    label: "OpenCode",
    description: "OpenAI-compatible",
    hint: "适合 OpenCode，自定义 OpenAI-compatible provider。",
    icon: FileCode2
  },
  {
    id: "claude-router",
    label: "Claude Router",
    description: "Switch 兼容",
    hint: "适合 Claude Code Router / switch 类工具，走 Chat Completions 兼容入口。",
    icon: Braces
  }
];

export const apiGuideOsOptions: Array<{
  id: ApiGuideOs;
  label: string;
}> = [
  { id: "unix", label: "macOS / Linux" },
  { id: "windows", label: "Windows" }
];

export function PreferenceSelect<T extends string>({
  ariaLabel,
  label,
  onChange,
  options,
  value
}: {
  ariaLabel?: string;
  label?: string;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  value: T;
}) {
  return (
    <label className="flex min-h-12 items-center justify-between gap-4">
      {label ? <span className="text-sm font-medium text-stone-900">{label}</span> : null}
      <select
        aria-label={ariaLabel || label}
        className="ios-input ml-auto h-10 w-36 shrink-0 bg-white/72 px-3 text-sm font-semibold"
        onChange={(event) => onChange(event.target.value as T)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ToggleRow({
  checked,
  description,
  disabled = false,
  label,
  onChange
}: {
  checked: boolean;
  description?: string;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div
      className={`flex min-h-16 items-center justify-between gap-4 px-4 py-3 ${
        disabled ? "opacity-60" : ""
      }`}
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold text-stone-950">{label}</p>
        {description ? <p className="mt-1 text-sm leading-5 ios-muted">{description}</p> : null}
      </div>
      <button
        aria-checked={checked}
        aria-disabled={disabled}
        className={`relative h-7 w-12 shrink-0 rounded-full transition ${
          checked ? "bg-[color:var(--claude-accent)]" : "bg-stone-200"
        }`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        role="switch"
        type="button"
      >
        <span
          className={`absolute top-1 size-5 rounded-full bg-white shadow-sm transition ${
            checked ? "left-6" : "left-1"
          }`}
        />
      </button>
    </div>
  );
}
