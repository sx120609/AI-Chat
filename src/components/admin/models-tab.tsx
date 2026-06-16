import { Loader2, RefreshCw } from "lucide-react";
import { formatCents, formatNumber } from "@/lib/format";
import {
  CHAT_MODELS,
  DEFAULT_UPSTREAM_MODEL_MAP,
  DEFAULT_IMAGE_UPSTREAM_MODEL,
  UNLIMITED_CONTEXT_WINDOW_TOKENS
} from "@/lib/models";
import type { AiSettingsView, ChatModelView } from "@/types/gateway";
import type { SettingsForm } from "./types";

type ModelsTabProps = {
  settings: AiSettingsView | null;
  settingsForm: SettingsForm;
  setSettingsForm: (
    updater: (current: SettingsForm) => SettingsForm | Partial<SettingsForm>
  ) => void;
  refreshingModels: boolean;
  onRefreshUpstreamModels: () => void;
};

function formatContextWindow(tokens: number) {
  return tokens >= UNLIMITED_CONTEXT_WINDOW_TOKENS ? "不限制" : formatNumber(tokens);
}

function ModelToggle({
  checked,
  model,
  onChange
}: {
  checked: boolean;
  model: ChatModelView;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="app-list-row flex min-h-14 w-full min-w-0 items-start gap-3 rounded-lg bg-white/70 px-3 py-2 text-sm cursor-pointer select-none">
      <input
        checked={checked}
        className="mt-1 size-4 accent-[color:var(--claude-accent)] cursor-pointer"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-slate-800">{model.label}</span>
        <span className="mt-0.5 block truncate text-xs ios-muted">
          {model.upstreamId} · {model.source === "upstream" ? "上游" : model.contextNote}
        </span>
        <span className="mt-1 block truncate text-[11px] ios-muted">
          上下文 {formatContextWindow(model.contextWindowTokens)} · 输入 {formatCents(model.inputCentsPerMillionTokens)}/百万 · 缓存{" "}
          {formatCents(model.cachedInputCentsPerMillionTokens)}/百万 · 输出{" "}
          {formatCents(model.outputCentsPerMillionTokens)}/百万
        </span>
      </span>
    </label>
  );
}

export function ModelsTab({
  settings,
  settingsForm,
  setSettingsForm,
  refreshingModels,
  onRefreshUpstreamModels
}: ModelsTabProps) {
  const handleUpdate = (patch: Partial<SettingsForm>) => {
    setSettingsForm((current) => ({ ...current, ...patch }));
  };

  return (
    <>
      <div className="ios-list lg:col-span-6">
        <div className="ios-cell flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <span className="text-xs font-semibold ios-muted">模型映射</span>
          <button
            className="ios-button-secondary app-action-button flex h-8 items-center gap-2 px-3 text-xs disabled:opacity-50"
            disabled={refreshingModels}
            onClick={onRefreshUpstreamModels}
            type="button"
          >
            {refreshingModels ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            刷新上游模型
          </button>
        </div>
        <div className="grid gap-3 p-3 md:grid-cols-2">
          {CHAT_MODELS.map((item) => (
            <label className="block" key={item.id}>
              <span className="mb-1 block text-xs font-medium ios-muted">
                {item.label} 发给上游的模型 ID
              </span>
              <input
                className="ios-input w-full"
                onChange={(event) =>
                  setSettingsForm((current) => ({
                    ...current,
                    chatModelMap: {
                      ...current.chatModelMap,
                      [item.id]: event.target.value
                    }
                  }))
                }
                placeholder={DEFAULT_UPSTREAM_MODEL_MAP[item.id]}
                value={settingsForm.chatModelMap[item.id] || ""}
              />
            </label>
          ))}
          <label className="block">
            <span className="mb-1 block text-xs font-medium ios-muted">
              image2 发给上游的模型 ID
            </span>
            <input
              className="ios-input w-full"
              onChange={(event) => handleUpdate({ imageModelId: event.target.value })}
              placeholder={DEFAULT_IMAGE_UPSTREAM_MODEL}
              value={settingsForm.imageModelId}
            />
          </label>
        </div>
      </div>

      <div className="ios-list lg:col-span-6">
        <div className="ios-cell px-3 py-2 text-xs font-semibold ios-muted">
          模型展示
        </div>
        <div className="grid gap-3 p-3">
          {(settings?.chatModels ?? []).map((item) => {
            const display = settingsForm.chatModelDisplay[item.id] || {};

            return (
              <div className="rounded-lg bg-white/70 p-3" key={item.id}>
                <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-slate-700">
                    {item.id}
                  </span>
                  <span className="shrink-0 text-[11px] ios-muted">
                    {item.source === "upstream" ? "上游" : "内置"}
                  </span>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium ios-muted">显示名称</span>
                    <input
                      className="ios-input w-full"
                      onChange={(event) =>
                        setSettingsForm((current) => ({
                          ...current,
                          chatModelDisplay: {
                            ...current.chatModelDisplay,
                            [item.id]: {
                              ...current.chatModelDisplay[item.id],
                              label: event.target.value
                            }
                          }
                        }))
                      }
                      placeholder={item.label}
                      value={display.label || ""}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium ios-muted">描述</span>
                    <input
                      className="ios-input w-full"
                      onChange={(event) =>
                        setSettingsForm((current) => ({
                          ...current,
                          chatModelDisplay: {
                            ...current.chatModelDisplay,
                            [item.id]: {
                              ...current.chatModelDisplay[item.id],
                              contextNote: event.target.value
                            }
                          }
                        }))
                      }
                      placeholder={item.contextNote}
                      value={display.contextNote || ""}
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="ios-list lg:col-span-6">
        <div className="ios-cell px-3 py-2 text-xs font-semibold ios-muted">
          启用模型
        </div>
        <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
          {(settings?.chatModels ?? []).map((item) => (
            <ModelToggle
              checked={settingsForm.enabledChatModelIds.includes(item.id)}
              key={item.id}
              model={item}
              onChange={(checked) =>
                setSettingsForm((current) => ({
                  ...current,
                  enabledChatModelIds: checked
                    ? [...new Set([...current.enabledChatModelIds, item.id])]
                    : current.enabledChatModelIds.filter((id) => id !== item.id)
                }))
              }
            />
          ))}
        </div>
      </div>
    </>
  );
}
