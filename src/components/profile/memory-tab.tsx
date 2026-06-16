import { FormEvent } from "react";
import {
  Database,
  Trash2,
  Archive,
  Plus,
  Loader2,
  Check,
  X,
  Pencil,
  RotateCcw,
  Save
} from "lucide-react";
import { PersonalizationSettings } from "@/lib/personalization";
import type { UserMemoryView } from "@/types/gateway";
import { UserProjectView } from "./types";
import { ToggleRow, memorySourceLabel } from "./components";

type MemoryTabProps = {
  personalization: PersonalizationSettings;
  updatePersonalization: (patch: Partial<PersonalizationSettings>) => void;
  memories: UserMemoryView[];
  activeMemories: UserMemoryView[];
  archivedMemories: UserMemoryView[];
  visibleMemories: UserMemoryView[];
  showArchivedMemories: boolean;
  setShowArchivedMemories: (show: boolean | ((curr: boolean) => boolean)) => void;
  projects: UserProjectView[];
  newMemoryProjectId: string;
  setNewMemoryProjectId: (projectId: string) => void;
  newMemoryContent: string;
  setNewMemoryContent: (content: string) => void;
  savingMemory: boolean;
  onCreateMemory: () => void;
  loadingMemories: boolean;
  editingMemoryId: string | null;
  setEditingMemoryId: (id: string | null) => void;
  editingMemoryContent: string;
  setEditingMemoryContent: (content: string) => void;
  onStartEditMemory: (memory: UserMemoryView) => void;
  onUpdateMemory: (
    memory: UserMemoryView,
    patch: Partial<Pick<UserMemoryView, "content">> & { archived?: boolean }
  ) => void;
  onSaveMemoryEdit: (memory: UserMemoryView) => void;
  setDeleteMemoryId: (id: string | null) => void;
  setClearMemoriesOpen: (open: boolean) => void;
  savingProfile: boolean;
  onSaveProfile: (event: FormEvent<HTMLFormElement>) => void;
  personalizationPayloadSize: number;
};

export function MemoryTab({
  personalization,
  updatePersonalization,
  memories,
  activeMemories,
  archivedMemories,
  visibleMemories,
  showArchivedMemories,
  setShowArchivedMemories,
  projects,
  newMemoryProjectId,
  setNewMemoryProjectId,
  newMemoryContent,
  setNewMemoryContent,
  savingMemory,
  onCreateMemory,
  loadingMemories,
  editingMemoryId,
  setEditingMemoryId,
  editingMemoryContent,
  setEditingMemoryContent,
  onStartEditMemory,
  onUpdateMemory,
  onSaveMemoryEdit,
  setDeleteMemoryId,
  setClearMemoriesOpen,
  savingProfile,
  onSaveProfile,
  personalizationPayloadSize
}: MemoryTabProps) {
  return (
    <form className="ios-panel motion-lift overflow-hidden" onSubmit={onSaveProfile}>
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--ios-separator)] px-4 py-4">
        <div className="flex items-center gap-2">
          <Database className="size-4 text-[color:var(--claude-accent)]" />
          <h2 className="text-base font-semibold">记忆</h2>
        </div>
        {memories.length > 0 ? (
          <button
            className="ios-button-secondary app-action-button flex h-9 items-center gap-2 px-3 text-sm text-red-600 disabled:opacity-60"
            disabled={savingMemory}
            onClick={() => setClearMemoriesOpen(true)}
            type="button"
          >
            <Trash2 className="size-4" />
            清空
          </button>
        ) : null}
      </div>

      <div className="divide-y divide-[color:var(--ios-separator)]">
        <ToggleRow
          checked={personalization.savedMemoryEnabled}
          description="开启后，聊天会引用下方保存的长期记忆，并允许 AI 判断是否新增、更新或删除这些记忆。"
          label="保存的记忆"
          onChange={(checked) => updatePersonalization({ savedMemoryEnabled: checked })}
        />
        <ToggleRow
          checked={personalization.savedMemoryEnabled && personalization.chatHistoryMemoryEnabled}
          description={
            personalization.savedMemoryEnabled
              ? "开启后，AI 可以参考近期聊天作为背景；关闭后不再把聊天历史作为长期上下文。"
              : "需要先开启保存的记忆；关闭保存的记忆会同时关闭引用聊天历史。"
          }
          disabled={!personalization.savedMemoryEnabled}
          label="引用聊天历史"
          onChange={(checked) => updatePersonalization({ chatHistoryMemoryEnabled: checked })}
        />
        <ToggleRow
          checked={personalization.temporaryChatDefault}
          description="新对话默认不读取、不写入长期记忆；适合隐私敏感问题。"
          label="默认临时聊天"
          onChange={(checked) => updatePersonalization({ temporaryChatDefault: checked })}
        />

        <div className="grid gap-4 px-4 py-4">
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-stone-950">保存的记忆</h3>
                <p className="mt-1 text-sm leading-5 ios-muted">
                  当前 {activeMemories.length} 条启用，{archivedMemories.length} 条已归档。
                </p>
              </div>
              <button
                className="ios-button-secondary app-action-button flex h-9 items-center gap-2 px-3 text-sm"
                onClick={() => setShowArchivedMemories(!showArchivedMemories)}
                type="button"
              >
                {showArchivedMemories ? <Database className="size-4" /> : <Archive className="size-4" />}
                {showArchivedMemories ? "只看启用" : "包含归档"}
              </button>
            </div>

            <div className="grid gap-2 sm:grid-cols-[minmax(8rem,12rem)_1fr_auto]">
              <select
                className="ios-input h-10 bg-white/72 px-3 text-sm font-semibold"
                onChange={(event) => setNewMemoryProjectId(event.target.value)}
                value={newMemoryProjectId}
              >
                <option value="">账号记忆</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <input
                className="ios-input"
                maxLength={280}
                onChange={(event) => setNewMemoryContent(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (newMemoryContent.trim()) {
                      onCreateMemory();
                    }
                  }
                }}
                placeholder="例如：我更喜欢直接给结论，再补充关键原因"
                value={newMemoryContent}
              />
              <button
                className="ios-button-primary app-action-button flex h-10 items-center justify-center gap-2 px-4 disabled:opacity-60"
                disabled={savingMemory || !newMemoryContent.trim()}
                onClick={onCreateMemory}
                type="button"
              >
                {savingMemory ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                添加记忆
              </button>
            </div>
          </div>

          {loadingMemories ? (
            <div className="grid min-h-24 place-items-center rounded-lg bg-white/45 text-stone-500">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : visibleMemories.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[color:var(--ios-separator)] bg-white/45 px-3 py-8 text-center text-sm ios-muted">
              暂无保存的记忆。你可以手动添加，或在聊天里说“记住……”。
            </div>
          ) : (
            <div className="grid gap-2">
              {visibleMemories.map((memory) => {
                const archived = Boolean(memory.archivedAt);
                const editing = editingMemoryId === memory.id;

                return (
                  <div
                    className={`grid gap-3 rounded-lg border border-[color:var(--ios-separator)] p-3 sm:grid-cols-[1fr_auto] ${
                      archived ? "bg-stone-100/70 opacity-80" : "bg-white/60"
                    }`}
                    key={memory.id}
                  >
                    <div className="min-w-0">
                      {editing ? (
                        <div className="grid gap-2">
                          <textarea
                            className="ios-input min-h-20 w-full resize-y py-3 text-sm leading-6"
                            maxLength={280}
                            onChange={(event) => setEditingMemoryContent(event.target.value)}
                            value={editingMemoryContent}
                          />
                          <div className="flex flex-wrap gap-2">
                            <button
                              className="ios-button-primary app-action-button flex h-9 items-center gap-2 px-3 text-sm disabled:opacity-60"
                              disabled={savingMemory}
                              onClick={() => onSaveMemoryEdit(memory)}
                              type="button"
                            >
                              <Check className="size-4" />
                              保存
                            </button>
                            <button
                              className="ios-button-secondary app-action-button flex h-9 items-center gap-2 px-3 text-sm"
                              onClick={() => {
                                setEditingMemoryId(null);
                                setEditingMemoryContent("");
                              }}
                              type="button"
                            >
                              <X className="size-4" />
                              取消
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="break-words text-sm leading-6 text-stone-900">{memory.content}</p>
                      )}
                      <p className="mt-2 flex flex-wrap items-center gap-2 text-xs ios-muted">
                        <span className="rounded-full bg-white/80 px-2 py-1 font-semibold">
                          {memorySourceLabel(memory.source)}
                        </span>
                        <span className="rounded-full bg-white/80 px-2 py-1 font-semibold">
                          {memory.projectName ? `项目：${memory.projectName}` : "账号记忆"}
                        </span>
                        {archived ? (
                          <span className="rounded-full bg-stone-200 px-2 py-1 font-semibold text-stone-600">
                            已归档
                          </span>
                        ) : null}
                        <span>更新 {new Date(memory.updatedAt).toLocaleString()}</span>
                      </p>
                    </div>
                    <div className="flex items-start gap-2 sm:justify-end">
                      <button
                        className="ios-icon-button app-action-button text-stone-600 disabled:opacity-60"
                        disabled={savingMemory || editing}
                        onClick={() => onStartEditMemory(memory)}
                        title="编辑记忆"
                        type="button"
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        className="ios-icon-button app-action-button text-stone-600 disabled:opacity-60"
                        disabled={savingMemory}
                        onClick={() => onUpdateMemory(memory, { archived: !archived })}
                        title={archived ? "恢复记忆" : "归档记忆"}
                        type="button"
                      >
                        {archived ? <RotateCcw className="size-4" /> : <Archive className="size-4" />}
                      </button>
                      <button
                        className="ios-icon-button app-action-button text-red-600 disabled:opacity-60"
                        disabled={savingMemory}
                        onClick={() => setDeleteMemoryId(memory.id)}
                        title="删除记忆"
                        type="button"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
          <p className="text-xs ios-muted">{personalizationPayloadSize}/8000</p>
          <button
            className="ios-button-primary app-action-button flex h-10 items-center justify-center gap-2 px-4 disabled:opacity-60"
            disabled={savingProfile}
            type="submit"
          >
            {savingProfile ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            保存记忆设置
          </button>
        </div>
      </div>
    </form>
  );
}
