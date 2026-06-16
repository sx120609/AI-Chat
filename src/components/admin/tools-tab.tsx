import { Code2, Globe2 } from "lucide-react";
import type { SettingsForm } from "./types";

type ToolsTabProps = {
  settingsForm: SettingsForm;
  setSettingsForm: (
    updater: (current: SettingsForm) => SettingsForm | Partial<SettingsForm>
  ) => void;
};

export function ToolsTab({ settingsForm, setSettingsForm }: ToolsTabProps) {
  const handleUpdate = (patch: Partial<SettingsForm>) => {
    setSettingsForm((current) => ({ ...current, ...patch }));
  };

  return (
    <>
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
            当前聊天不会自动调用代码解释器；附件会直接交给主模型，必要时仅使用内置文本解析作为兜底。
          </div>
        </div>
      </div>

      <div className="ios-list lg:col-span-6">
        <div className="ios-cell flex items-center gap-2 px-3 py-2">
          <Globe2 className="size-4 text-[color:var(--claude-accent)]" />
          <span className="text-xs font-semibold ios-muted">联网搜索</span>
        </div>
        <div className="grid gap-3 p-3 lg:grid-cols-2">
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
          <div className="admin-note lg:col-span-2">
            开启后，用户可在聊天输入框为单次消息打开联网搜索；后端通过 DuckDuckGo 搜索并把来源卡片随消息保存，前端用户浏览器不会直接访问搜索引擎。
          </div>
        </div>
      </div>
    </>
  );
}
