import { Code2, Globe2 } from "lucide-react";
import type { SettingsForm } from "./types";
import { normalizeResponsesTools } from "@/lib/responses-tools";

type ToolsTabProps = {
  settingsForm: SettingsForm;
  setSettingsForm: (
    updater: (current: SettingsForm) => SettingsForm | Partial<SettingsForm>
  ) => void;
};

export function ToolsTab({ settingsForm, setSettingsForm }: ToolsTabProps) {
  const native = normalizeResponsesTools(settingsForm.responsesTools);
  const updateNative = (patch: Partial<typeof native>) => handleUpdate({ responsesTools: { ...native, ...patch } });
  const handleUpdate = (patch: Partial<SettingsForm>) => {
    setSettingsForm((current) => ({ ...current, ...patch }));
  };

  return (
    <>
      <div className="ios-list lg:col-span-6">
        <div className="ios-cell px-3 py-2 text-xs font-semibold">任务工具与上游能力</div>
        <div className="grid gap-4 p-3 lg:grid-cols-2">
          {([['artifacts', '创建可下载成果（本站保存）'], ['codeInterpreter', '上游代码执行（需验证支持）'], ['imageGeneration', '上游图片生成（需验证模型）'], ['fileSearch', '上游共享知识库（需验证支持）']] as const).map(([key, label]) => <label key={key} className="admin-check-row"><input type="checkbox" checked={native[key]} onChange={event => updateNative({ [key]: event.target.checked })} />{label}</label>)}
          <label className="block lg:col-span-2"><span className="mb-1 block text-xs">支持原生工具的模型 ID（逗号分隔，留空应用到全部模型）</span><input className="ios-input w-full" value={(settingsForm.responsesTools?.modelIds || []).join(",")} onChange={event => updateNative({ modelIds: event.target.value.split(/[,，]/).map(value => value.trim()) })} /></label>
          <label className="block lg:col-span-2"><span className="mb-1 block text-xs">共享知识库 Vector Store ID（逗号分隔）</span><input className="ios-input w-full" value={(settingsForm.responsesTools?.sharedVectorStoreIds || []).join(",")} onChange={event => updateNative({ sharedVectorStoreIds: event.target.value.split(/[,，]/).map(value => value.trim()) })} /></label>
          {([['codeSessionCostCents', '每个代码容器附加费用（美分）'], ['imageCostCents', '每次生图附加费用（美分）'], ['fileSearchCostCents', '每次知识库检索附加费用（美分）']] as const).map(([key, label]) => <label key={key}><span className="mb-1 block text-xs">{label}</span><input className="ios-input w-full" type="number" min="0" step="0.01" value={native[key]} onChange={event => updateNative({ [key]: Number(event.target.value) })} /></label>)}
          <div className="admin-note lg:col-span-2">这些开关是请求配置，不代表上游已支持。可下载成果由本站通过 function calling 保存；Sub2API 有图片生成适配，但仍受版本、账号和模型限制。代码执行及知识库需单独验证，代码成果下载还要求上游提供容器文件接口。附加费用是本站收费配置，不是上游报价。共享知识库会供所有有文件分析权限的用户检索，请仅填写可共享资料。旧图片入口仍使用原有图片服务。</div>
        </div>
      </div>
      <div className="ios-list lg:col-span-6">
        <div className="ios-cell flex items-center gap-2 px-3 py-2">
          <Code2 className="size-4 text-[color:var(--claude-accent)]" />
          <span className="text-xs font-semibold ios-muted">代码解释器沙箱</span>
        </div>
        <div className="grid gap-3 p-3 lg:grid-cols-3">
          <label className="admin-check-row">
            <input
              checked={settingsForm.codeInterpreterEnabled}
              className="size-4 accent-[color:var(--claude-accent)]"
              onChange={(event) =>
                handleUpdate({ codeInterpreterEnabled: event.target.checked })
              }
              type="checkbox"
            />
            保留代码解释器配置
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium ios-muted">沙箱</span>
            <select
              className="ios-select w-full"
              onChange={(event) =>
                handleUpdate({ codeInterpreterSandbox: event.target.value })
              }
              value={settingsForm.codeInterpreterSandbox}
            >
              <option value="docker">Docker 容器</option>
            </select>
          </label>
          <label className="admin-check-row">
            <input
              checked={settingsForm.codeInterpreterAllowPackageInstall}
              className="size-4 accent-[color:var(--claude-accent)]"
              onChange={(event) =>
                handleUpdate({ codeInterpreterAllowPackageInstall: event.target.checked })
              }
              type="checkbox"
            />
            允许沙箱内安装包
          </label>
          <label className="block lg:col-span-2">
            <span className="mb-1 block text-xs font-medium ios-muted">Python 包源</span>
            <input
              className="ios-input w-full"
              onChange={(event) =>
                handleUpdate({ codeInterpreterPipIndexUrl: event.target.value })
              }
              placeholder="https://pypi.org/simple"
              value={settingsForm.codeInterpreterPipIndexUrl}
            />
          </label>
          <div className="admin-note">
            此处保留原有本地 Docker 配置；网页任务使用上方配置的 Responses 原生代码执行。附件仍支持直接输入及文本解析。
          </div>
        </div>
      </div>

      <div className="ios-list lg:col-span-6">
        <div className="ios-cell flex items-center gap-2 px-3 py-2">
          <Globe2 className="size-4 text-[color:var(--claude-accent)]" />
          <span className="text-xs font-semibold ios-muted">联网搜索</span>
        </div>
        <div className="grid gap-3 p-3 lg:grid-cols-3">
          <label className="admin-check-row">
            <input
              checked={settingsForm.webSearchEnabled}
              className="size-4 accent-[color:var(--claude-accent)]"
              onChange={(event) =>
                handleUpdate({ webSearchEnabled: event.target.checked })
              }
              type="checkbox"
            />
            允许用户联网搜索
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium ios-muted">来源数量</span>
            <input
              className="ios-input w-full"
              max={8}
              min={1}
              onChange={(event) =>
                handleUpdate({ webSearchMaxResults: Number(event.target.value) })
              }
              type="number"
              value={settingsForm.webSearchMaxResults}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium ios-muted">
              每次查询费用（美分）
            </span>
            <input
              className="ios-input w-full"
              min={0}
              onChange={(event) =>
                handleUpdate({ webSearchCostCents: Number(event.target.value) })
              }
              step="0.01"
              type="number"
              value={settingsForm.webSearchCostCents}
            />
          </label>
          <div className="admin-note lg:col-span-3">
            联网搜索按实际查询次数附加计费，并与模型输入、缓存和输出 token 费用一并扣除；当前默认每次 1 美分。来源卡片会随消息保存。
          </div>
        </div>
      </div>
    </>
  );
}
