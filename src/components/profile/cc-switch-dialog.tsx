import { useId, useMemo, useState } from "react";
import { ExternalLink, KeyRound, X } from "lucide-react";
import { buildCCSwitchImportUrl, type CCSwitchApp } from "@/lib/cc-switch";
import type { ChatModelView, UserApiKeyView } from "@/types/gateway";

const APP_CONFIGS = {
  claude: {
    label: "Claude",
    defaultName: "My Claude",
    fields: [
      { key: "model", label: "主模型", required: true },
      { key: "haikuModel", label: "Haiku 模型", required: false },
      { key: "sonnetModel", label: "Sonnet 模型", required: false },
      { key: "opusModel", label: "Opus 模型", required: false }
    ]
  },
  codex: {
    label: "Codex",
    defaultName: "My Codex",
    fields: [{ key: "model", label: "主模型", required: true }]
  },
  gemini: {
    label: "Gemini",
    defaultName: "My Gemini",
    fields: [{ key: "model", label: "主模型", required: true }]
  }
} as const;

type CCSwitchDialogProps = {
  apiKey: UserApiKeyView;
  models: ChatModelView[];
  onClose: () => void;
  serverAddress: string;
};

type ModelField = "model" | "haikuModel" | "sonnetModel" | "opusModel";

export function CCSwitchDialog({ apiKey, models: availableModels, onClose, serverAddress }: CCSwitchDialogProps) {
  const modelListId = useId();
  const [app, setApp] = useState<CCSwitchApp>("claude");
  const [name, setName] = useState<string>(APP_CONFIGS.claude.defaultName);
  const [models, setModels] = useState<Partial<Record<ModelField, string>>>({});
  const [error, setError] = useState("");
  const currentConfig = APP_CONFIGS[app];
  const modelOptions = useMemo(
    () => [...new Set(availableModels.map((model) => model.id.trim()).filter(Boolean))],
    [availableModels]
  );
  const resolvedServerAddress =
    serverAddress || (typeof window !== "undefined" ? window.location.origin : "");

  function changeApp(nextApp: CCSwitchApp) {
    setApp(nextApp);
    setName(APP_CONFIGS[nextApp].defaultName);
    setModels({});
    setError("");
  }

  function openCCSwitch() {
    if (!apiKey.apiKey) {
      setError("这个 Key 无法查看明文，请重新创建后再导入。");
      return;
    }

    if (!name.trim()) {
      setError("请输入配置名称。");
      return;
    }

    if (!models.model?.trim()) {
      setError("请选择或输入主模型。");
      return;
    }

    try {
      const url = buildCCSwitchImportUrl({
        app,
        apiKey: apiKey.apiKey,
        models: {
          model: models.model,
          haikuModel: models.haikuModel,
          sonnetModel: models.sonnetModel,
          opusModel: models.opusModel
        },
        name,
        serverAddress: resolvedServerAddress
      });

      window.location.assign(url);
      onClose();
    } catch (buildError) {
      setError(buildError instanceof Error ? buildError.message : "生成 CC Switch 导入链接失败。");
    }
  }

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-stone-950/35 px-3 py-[calc(1rem+var(--app-safe-area-top,0px))] backdrop-blur-sm sm:p-6">
      <button aria-label="关闭 CC Switch 导入" className="absolute inset-0" onClick={onClose} type="button" />
      <section
        aria-labelledby="cc-switch-dialog-title"
        aria-modal="true"
        className="app-modal-panel relative flex max-h-[min(48rem,calc(100dvh-2rem))] w-full max-w-lg flex-col overflow-hidden rounded-[1.25rem] border border-[color:var(--ios-separator)] bg-[color:var(--claude-surface)] text-stone-950 shadow-[0_26px_90px_rgba(18,42,35,0.24)] ring-1 ring-white/70"
        role="dialog"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[color:var(--ios-separator)] px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 className="text-lg font-bold leading-7" id="cc-switch-dialog-title">
              导入到 CC Switch
            </h2>
            <p className="mt-1 text-sm ios-muted">选择应用和模型，一键写入本机 Provider 配置。</p>
          </div>
          <button className="ios-icon-button app-action-button shrink-0" onClick={onClose} title="关闭" type="button">
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <div className="grid gap-4">
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-stone-800">应用</legend>
              <div className="grid grid-cols-3 gap-1 rounded-xl border border-[color:var(--ios-separator)] bg-white/45 p-1">
                {(Object.keys(APP_CONFIGS) as CCSwitchApp[]).map((appId) => (
                  <button
                    aria-pressed={app === appId}
                    className={`app-action-button h-10 rounded-lg px-2 text-sm font-semibold transition ${
                      app === appId
                        ? "bg-[color:var(--claude-accent)] text-white shadow-sm"
                        : "text-stone-600 hover:bg-white/70 hover:text-stone-950"
                    }`}
                    key={appId}
                    onClick={() => changeApp(appId)}
                    type="button"
                  >
                    {APP_CONFIGS[appId].label}
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-stone-800">名称</span>
              <input
                autoComplete="off"
                className="ios-input w-full"
                onChange={(event) => {
                  setName(event.target.value);
                  setError("");
                }}
                placeholder={currentConfig.defaultName}
                value={name}
              />
            </label>

            <datalist id={modelListId}>
              {modelOptions.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>

            {currentConfig.fields.map((field) => (
              <label className="block" key={field.key}>
                <span className="mb-1.5 block text-sm font-semibold text-stone-800">
                  {field.label}
                  {field.required ? <span className="ml-0.5 text-red-600">*</span> : null}
                </span>
                <input
                  autoComplete="off"
                  className="ios-input w-full"
                  list={modelListId}
                  onChange={(event) => {
                    setModels((current) => ({ ...current, [field.key]: event.target.value }));
                    setError("");
                  }}
                  placeholder="请选择或输入模型名称"
                  value={models[field.key] || ""}
                />
              </label>
            ))}

            {app === "codex" ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-800">
                导入内容已包含 Codex 0.149.0+ 所需的 <code>requires_openai_auth = true</code>
                和完整鉴权配置。导入或切换后请完全退出并重启 Codex。
              </div>
            ) : null}

            <div className="rounded-xl border border-[color:var(--ios-separator)] bg-white/55 p-3 text-xs text-stone-600">
              <div className="flex items-center gap-2 font-semibold text-stone-800">
                <KeyRound className="size-3.5 text-[color:var(--claude-accent)]" />
                {apiKey.name}
              </div>
              <p className="mt-1 break-all font-mono">{apiKey.keyPrefix}...</p>
              <p className="mt-2 leading-5">
                打开后，浏览器会通过 <code>ccswitch://</code> 将接口地址、模型和当前 Key 交给本机 CC Switch。请只在可信设备上操作。
              </p>
            </div>

            {error ? (
              <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-[color:var(--ios-separator)] px-4 py-3 sm:flex-row sm:justify-end sm:px-6">
          <button className="ios-button-secondary app-action-button h-10 px-4 text-sm" onClick={onClose} type="button">
            取消
          </button>
          <button className="ios-button-primary app-action-button inline-flex h-10 items-center justify-center gap-2 px-4 text-sm" onClick={openCCSwitch} type="button">
            <ExternalLink className="size-4" />
            打开 CC Switch
          </button>
        </div>
      </section>
    </div>
  );
}
