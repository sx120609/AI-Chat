import { SYSTEM_PROMPT_MODES } from "@/lib/system-prompt";
import type { AiSettingsView, SystemPromptMode } from "@/types/gateway";
import type { SettingsForm } from "./types";

type PromptsTabProps = {
  settings: AiSettingsView | null;
  settingsForm: SettingsForm;
  setSettingsForm: (
    updater: (current: SettingsForm) => SettingsForm | Partial<SettingsForm>
  ) => void;
  defaultPromptPreview: string;
};

export function PromptsTab({
  settings,
  settingsForm,
  setSettingsForm,
  defaultPromptPreview
}: PromptsTabProps) {
  const handleUpdate = (patch: Partial<SettingsForm>) => {
    setSettingsForm((current) => ({ ...current, ...patch }));
  };

  return (
    <div className="ios-list lg:col-span-6">
      <div className="ios-cell px-3 py-2">
        <p className="text-xs font-semibold ios-muted">身份与系统提示词</p>
      </div>
      <div className="grid gap-3 p-3">
        <div className="grid gap-3 lg:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium ios-muted">注入模式</span>
            <select
              className="ios-select w-full"
              onChange={(event) =>
                handleUpdate({ systemPromptMode: event.target.value as SystemPromptMode })
              }
              value={settingsForm.systemPromptMode}
            >
              {SYSTEM_PROMPT_MODES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <div className="admin-note lg:col-span-2">
            {SYSTEM_PROMPT_MODES.find((item) => item.id === settingsForm.systemPromptMode)
              ?.description || ""}
          </div>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium ios-muted">全局追加/自定义系统提示词</span>
          <textarea
            className="ios-input min-h-28 w-full resize-y py-2 text-sm leading-6"
            onChange={(event) => handleUpdate({ customSystemPrompt: event.target.value })}
            placeholder="支持 {model}、{date}、{time} 和 {timezone}。默认 + 追加模式下会保留内置模板。"
            value={settingsForm.customSystemPrompt}
          />
        </label>
        <details className="rounded-lg border border-[color:var(--ios-separator)] bg-white/60 px-3 py-2">
          <summary className="cursor-pointer select-none text-xs font-semibold text-stone-700">
            查看内置默认提示词
          </summary>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-stone-900 p-3 text-xs leading-5 text-stone-50">
            {defaultPromptPreview}
          </pre>
        </details>
        <div>
          <p className="mb-2 text-xs font-medium ios-muted">模型专属系统提示词</p>
          <div className="grid gap-3 lg:grid-cols-2">
            {(settings?.chatModels ?? []).map((item) => (
              <label className="block" key={item.id}>
                <span className="mb-1 block truncate text-xs font-medium ios-muted">
                  {item.label}
                </span>
                <textarea
                  className="ios-input min-h-24 w-full resize-y py-2 text-sm leading-6"
                  onChange={(event) =>
                    setSettingsForm((current) => ({
                      ...current,
                      modelSystemPrompts: {
                        ...current.modelSystemPrompts,
                        [item.id]: event.target.value
                      }
                    }))
                  }
                  placeholder="留空则使用全局设置。支持 {model}、{date}、{time} 和 {timezone}。"
                  value={settingsForm.modelSystemPrompts[item.id] || ""}
                />
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
