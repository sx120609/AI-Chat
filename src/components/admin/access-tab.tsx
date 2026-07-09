import { REASONING_EFFORTS, REASONING_PARAM_MODES } from "@/lib/models";
import type { AiSettingsView, ReasoningEffort, ReasoningParamMode } from "@/types/gateway";
import type { SettingsForm } from "./types";

type AccessTabProps = {
  settings: AiSettingsView | null;
  settingsForm: SettingsForm;
  setSettingsForm: (
    updater: (current: SettingsForm) => SettingsForm | Partial<SettingsForm>
  ) => void;
};

export function AccessTab({
  settings,
  settingsForm,
  setSettingsForm
}: AccessTabProps) {
  const handleUpdate = (patch: Partial<SettingsForm>) => {
    setSettingsForm((current) => ({ ...current, ...patch }));
  };

  return (
    <>
    <div className="ios-list lg:col-span-6">
      <div className="ios-cell px-3 py-2">
        <p className="text-xs font-semibold ios-muted">
          Key 已隐藏保存：{settings?.hasApiKey ? settings.apiKeyPreview : "未设置"}
        </p>
      </div>
      <div className="grid gap-3 p-3 lg:grid-cols-6">
        <label className="block lg:col-span-2">
          <span className="mb-1 block text-xs font-medium ios-muted">站点名称</span>
          <input
            autoComplete="organization"
            className="ios-input w-full"
            onChange={(event) => handleUpdate({ siteName: event.target.value })}
            placeholder="Team AI Gateway"
            value={settingsForm.siteName}
          />
        </label>
        <label className="block lg:col-span-4">
          <span className="mb-1 block text-xs font-medium ios-muted">站点地址</span>
          <input
            autoComplete="off"
            className="ios-input w-full"
            onChange={(event) => handleUpdate({ siteUrl: event.target.value })}
            placeholder="https://chat.example.com"
            value={settingsForm.siteUrl}
          />
        </label>
        <label className="block lg:col-span-3">
          <span className="mb-1 block text-xs font-medium ios-muted">API 地址</span>
          <input
            autoComplete="off"
            className="ios-input w-full"
            onChange={(event) => handleUpdate({ apiBaseUrl: event.target.value })}
            placeholder="https://api.openai.com/v1"
            value={settingsForm.apiBaseUrl}
          />
        </label>
        <label className="block lg:col-span-2">
          <span className="mb-1 block text-xs font-medium ios-muted">API Key</span>
          <input
            autoComplete="new-password"
            className="ios-input w-full"
            name="admin-upstream-api-key"
            onChange={(event) =>
              handleUpdate({
                apiKey: event.target.value,
                clearApiKey: false
              })
            }
            placeholder={settings?.hasApiKey ? "输入新 Key 后替换" : "输入 API Key"}
            type="password"
            value={settingsForm.apiKey}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium ios-muted">Org ID</span>
          <input
            autoComplete="off"
            className="ios-input w-full"
            onChange={(event) => handleUpdate({ orgId: event.target.value })}
            placeholder="可选"
            value={settingsForm.orgId}
          />
        </label>
        <label className="block lg:col-span-2">
          <span className="mb-1 block text-xs font-medium ios-muted">默认推理强度</span>
          <select
            className="ios-select w-full"
            onChange={(event) =>
              handleUpdate({
                defaultReasoningEffort: event.target.value as ReasoningEffort
              })
            }
            value={settingsForm.defaultReasoningEffort}
          >
            {REASONING_EFFORTS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block lg:col-span-2">
          <span className="mb-1 block text-xs font-medium ios-muted">推理参数格式</span>
          <select
            className="ios-select w-full"
            onChange={(event) =>
              handleUpdate({
                reasoningParamMode: event.target.value as ReasoningParamMode
              })
            }
            value={settingsForm.reasoningParamMode}
          >
            {REASONING_PARAM_MODES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-check-row">
          <input
            checked={settingsForm.mockResponses}
            className="size-4 accent-[color:var(--claude-accent)]"
            onChange={(event) =>
              handleUpdate({
                mockResponses: event.target.checked
              })
            }
            type="checkbox"
          />
          Mock 模式
        </label>
        <label className="admin-check-row">
          <input
            checked={settingsForm.clearApiKey}
            className="size-4 accent-red-500"
            onChange={(event) =>
              handleUpdate({
                clearApiKey: event.target.checked,
                apiKey: event.target.checked ? "" : settingsForm.apiKey
              })
            }
            type="checkbox"
          />
          清空 Key
        </label>
      </div>
    </div>

    <div className="ios-list lg:col-span-6">
      <div className="ios-cell px-3 py-2">
        <p className="text-xs font-semibold ios-muted">
          GPT-5.4-Pro 专用 Key 已隐藏保存：
          {settings?.gpt54ProHasApiKey ? settings.gpt54ProApiKeyPreview : "未设置"}
        </p>
        <p className="mt-1 text-[11px] ios-muted">
          仅在选择 GPT-5.4-Pro 时使用，调用上游 /responses；留空则回退主中转站。
        </p>
      </div>
      <div className="grid gap-3 p-3 lg:grid-cols-6">
        <label className="block lg:col-span-3">
          <span className="mb-1 block text-xs font-medium ios-muted">GPT-5.4-Pro API 地址</span>
          <input
            autoComplete="off"
            className="ios-input w-full"
            onChange={(event) => handleUpdate({ gpt54ProApiBaseUrl: event.target.value })}
            placeholder={settingsForm.apiBaseUrl || "https://api.openai.com/v1"}
            value={settingsForm.gpt54ProApiBaseUrl}
          />
        </label>
        <label className="block lg:col-span-2">
          <span className="mb-1 block text-xs font-medium ios-muted">GPT-5.4-Pro API Key</span>
          <input
            autoComplete="new-password"
            className="ios-input w-full"
            name="admin-gpt54-pro-api-key"
            onChange={(event) =>
              handleUpdate({
                gpt54ProApiKey: event.target.value,
                clearGpt54ProApiKey: false
              })
            }
            placeholder={settings?.gpt54ProHasApiKey ? "输入新 Key 后替换" : "输入 API Key"}
            type="password"
            value={settingsForm.gpt54ProApiKey}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium ios-muted">GPT-5.4-Pro Org ID</span>
          <input
            autoComplete="off"
            className="ios-input w-full"
            onChange={(event) => handleUpdate({ gpt54ProOrgId: event.target.value })}
            placeholder="可选"
            value={settingsForm.gpt54ProOrgId}
          />
        </label>
        <label className="admin-check-row lg:col-span-2">
          <input
            checked={settingsForm.clearGpt54ProApiKey}
            className="size-4 accent-red-500"
            onChange={(event) =>
              handleUpdate({
                clearGpt54ProApiKey: event.target.checked,
                gpt54ProApiKey: event.target.checked ? "" : settingsForm.gpt54ProApiKey
              })
            }
            type="checkbox"
          />
          清空 GPT-5.4-Pro Key
        </label>
      </div>
    </div>
    </>
  );
}
