import { Loader2, RefreshCw } from "lucide-react";
import { formatCents, formatNumber } from "@/lib/format";
import {
  CHAT_MODELS,
  DEFAULT_UPSTREAM_MODEL_MAP,
  DEFAULT_IMAGE_UPSTREAM_MODEL
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

function commonContextTokensForModel(model: ChatModelView) {
  const signature = `${model.id} ${model.label} ${model.upstreamId}`.toLowerCase();

  if (signature.includes("spark") || signature.includes("gpt-5.3")) {
    return 400_000;
  }

  if (signature.includes("gpt-6-astra") || signature.includes("gpt-5.6") || signature.includes("gpt-5.5") || signature.includes("gpt-5.4")) {
    return 1_000_000;
  }

  return model.contextWindowTokens >= 1_000_000_000 ? 1_000_000 : model.contextWindowTokens;
}

function formatCompactContext(tokens: number) {
  if (tokens >= 1_000_000) {
    const value = tokens / 1_000_000;
    return Number.isInteger(value) ? `${value}M` : `${value.toFixed(1)}M`;
  }

  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}K`;
  }

  return formatNumber(tokens);
}

function formatContextWindow(model: ChatModelView) {
  return `上下文 ${formatCompactContext(commonContextTokensForModel(model))}`;
}

function ModelAvailabilityCard({
  enabled,
  model,
  onEnabledChange,
  onVisibleChange,
  visible
}: {
  enabled: boolean;
  model: ChatModelView;
  onEnabledChange: (checked: boolean) => void;
  onVisibleChange: (checked: boolean) => void;
  visible: boolean;
}) {
  return (
    <div className="app-list-row min-h-14 w-full min-w-0 rounded-lg bg-white/70 px-3 py-3 text-sm">
      <div className="min-w-0">
        <span className="block truncate font-medium text-slate-800">{model.label}</span>
        <span className="mt-0.5 block truncate text-xs ios-muted">
          {model.upstreamId} · {model.source === "upstream" ? "上游" : model.contextNote}
        </span>
        <span className="mt-1 block truncate text-[11px] ios-muted">
          {formatContextWindow(model)} · 输入 {formatCents(model.inputCentsPerMillionTokens)}/百万 · 缓存{" "}
          {formatCents(model.cachedInputCentsPerMillionTokens)}/百万 · 输出{" "}
          {formatCents(model.outputCentsPerMillionTokens)}/百万
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-black/5 pt-2">
        <label className="inline-flex cursor-pointer select-none items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm">
          <input
            checked={enabled}
            className="size-4 accent-[color:var(--claude-accent)]"
            onChange={(event) => onEnabledChange(event.target.checked)}
            type="checkbox"
          />
          启用模型
        </label>
        <label
          className={`inline-flex select-none items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium shadow-sm ${
            enabled
              ? "cursor-pointer bg-[color:var(--app-accent-soft)] text-[color:var(--claude-accent-dark)]"
              : "cursor-not-allowed bg-stone-100 text-stone-400"
          }`}
        >
          <input
            checked={enabled && visible}
            className="size-4 accent-[color:var(--claude-accent)]"
            disabled={!enabled}
            onChange={(event) => onVisibleChange(event.target.checked)}
            type="checkbox"
          />
          聊天中显示
        </label>
      </div>
    </div>
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
            刷新模型与价格
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
        <div className="ios-cell px-3 py-2">
          <p className="text-xs font-semibold ios-muted">模型可用性</p>
          <p className="mt-1 text-[11px] ios-muted">
            “启用模型”控制接口与后台能力；关闭“聊天中显示”只会从聊天模型列表隐藏。
          </p>
        </div>
        <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
          {(settings?.chatModels ?? []).map((item) => {
            const enabled = settingsForm.enabledChatModelIds.includes(item.id);
            const visible = settingsForm.visibleChatModelIds.includes(item.id);

            return (
              <ModelAvailabilityCard
                enabled={enabled}
                key={item.id}
                model={item}
                onEnabledChange={(checked) =>
                  setSettingsForm((current) => ({
                    ...current,
                    enabledChatModelIds: checked
                      ? [...new Set([...current.enabledChatModelIds, item.id])]
                      : current.enabledChatModelIds.filter((id) => id !== item.id),
                    visibleChatModelIds: checked
                      ? [...new Set([...current.visibleChatModelIds, item.id])]
                      : current.visibleChatModelIds.filter((id) => id !== item.id)
                  }))
                }
                onVisibleChange={(checked) =>
                  setSettingsForm((current) => ({
                    ...current,
                    visibleChatModelIds: checked
                      ? [...new Set([...current.visibleChatModelIds, item.id])]
                      : current.visibleChatModelIds.filter((id) => id !== item.id)
                  }))
                }
                visible={visible}
              />
            );
          })}
        </div>
      </div>
    </>
  );
}
