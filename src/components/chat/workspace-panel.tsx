"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Code2, Download, FileText, FolderOpen, Globe2, Loader2, PencilLine, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { MessageView } from "@/types/gateway";
import type { WorkspaceArtifact } from "@/lib/responses-state";

export type ArtifactEntry = WorkspaceArtifact & { messageId: string; version: number };
export function collectArtifacts(messages: MessageView[]): ArtifactEntry[] {
  const versions = new Map<string, number>();
  return messages.flatMap(message => (message.response?.artifacts || []).map(artifact => {
    const version = (versions.get(artifact.filename) || 0) + 1;
    versions.set(artifact.filename, version);
    return { ...artifact, messageId: message.id, version };
  }));
}

const PREVIEW_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";

function downloadArtifact(artifact: ArtifactEntry) {
  if (artifact.imageData) {
    const bytes = Uint8Array.from(atob(artifact.imageData), character => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: artifact.mimeType }));
    const link = document.createElement("a");
    link.href = url; link.download = artifact.filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  if (artifact.content === undefined) {
    const link = document.createElement("a");
    link.href = `/api/messages/${encodeURIComponent(artifact.messageId)}/artifacts/${encodeURIComponent(artifact.id)}`;
    link.click();
    return;
  }
  const url = URL.createObjectURL(new Blob([artifact.content], { type: artifact.mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = artifact.filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function WorkspacePanel({ messages, onClose, onRevise, selectedKey, onSelect }: {
  messages: MessageView[];
  onClose: () => void;
  onRevise: (prompt: string) => void;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}) {
  const artifacts = useMemo(() => collectArtifacts(messages), [messages]);
  const selected = artifacts.find(item => `${item.messageId}:${item.id}` === selectedKey) || artifacts.at(-1);
  const [tab, setTab] = useState<"artifacts" | "activity" | "sources">("artifacts");
  const [sourceMode, setSourceMode] = useState(false);
  const latest = messages.filter(message => message.role === "ASSISTANT").at(-1);
  const events = latest?.toolEvents || [];
  const sources = [...new Map(messages.flatMap(message => message.webSources || []).map(source => [source.url, source])).values()];
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <aside aria-label="任务工作区" className="workspace-panel fixed inset-0 z-50 flex min-h-0 flex-col border-l border-stone-200 bg-[#fafaf8] text-stone-800 xl:static xl:z-auto xl:w-[min(44vw,680px)] xl:shrink-0">
      <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-stone-200 px-5 pt-[env(safe-area-inset-top)] xl:pt-0">
        <div className="flex items-center gap-2 text-sm font-semibold"><FolderOpen className="size-4" />任务工作区</div>
        <button aria-label="关闭工作区" className="rounded-lg p-2 hover:bg-stone-200" onClick={onClose}><X className="size-4" /></button>
      </div>
      <div className="flex shrink-0 gap-1 border-b border-stone-200 px-4 py-2" role="tablist" aria-label="工作区内容">
        {([['artifacts', `成果 ${artifacts.length}`], ['activity', '执行过程'], ['sources', `来源 ${sources.length}`]] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`rounded-lg px-3 py-2 text-xs font-medium ${tab === id ? 'bg-white shadow-sm text-stone-950' : 'text-stone-500 hover:text-stone-900'}`}>{label}</button>
        ))}
      </div>
      {tab === "artifacts" ? (
        artifacts.length ? <>
          <div className="max-h-40 shrink-0 overflow-y-auto border-b border-stone-200 p-3">
            {artifacts.map(artifact => <button key={`${artifact.messageId}:${artifact.id}`} onClick={() => { onSelect(`${artifact.messageId}:${artifact.id}`); setSourceMode(false); }} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm ${selected === artifact ? 'bg-stone-200/65' : 'hover:bg-stone-100'}`}>
              <FileText className="size-4 shrink-0 text-stone-500" /><span className="min-w-0 flex-1 truncate">{artifact.filename}</span><span className="text-xs text-stone-500">v{artifact.version}</span><ChevronRight className="size-3" />
            </button>)}
          </div>
          {selected ? <>
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-4 py-3">
              <div className="min-w-0"><h2 className="max-w-64 truncate text-sm font-semibold">{selected.title}</h2><p className="mt-0.5 text-xs text-stone-500">{selected.filename} · 版本 {selected.version}</p></div>
              <div className="flex gap-1">
                {selected.content !== undefined && <button aria-label={sourceMode ? "显示预览" : "查看源码"} className="rounded-lg p-2 hover:bg-stone-200" onClick={() => setSourceMode(!sourceMode)}><Code2 className="size-4" /></button>}
                <button aria-label="继续修改成果" className="rounded-lg p-2 hover:bg-stone-200" onClick={() => { onRevise(`请继续修改成果「${selected.filename}」（版本 ${selected.version}）：\n`); onClose(); }}><PencilLine className="size-4" /></button>
                <button aria-label="下载成果" className="rounded-lg p-2 hover:bg-stone-200" onClick={() => downloadArtifact(selected)}><Download className="size-4" /></button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-white p-5">
              {selected.imageData ? <img alt={selected.title} className="h-auto w-full rounded-lg" src={`data:${selected.mimeType};base64,${selected.imageData}`} /> : selected.content === undefined ? <div className="grid h-full place-content-center gap-4 text-center"><FileText className="mx-auto size-10 text-stone-400" /><p className="text-sm">文件已生成，可下载后打开。</p><button className="rounded-xl bg-stone-900 px-4 py-2 text-sm text-white" onClick={() => downloadArtifact(selected)}>下载 {selected.filename}</button></div>
                : !sourceMode && (selected.mimeType === "text/html" || selected.mimeType === "image/svg+xml") ? <iframe title={selected.title} sandbox="allow-scripts" referrerPolicy="no-referrer" className="h-full min-h-96 w-full rounded-lg border border-stone-100 bg-white" srcDoc={`<!doctype html><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">${selected.content}`} />
                : !sourceMode && selected.mimeType === "text/markdown" ? <div className="claude-markdown break-words"><ReactMarkdown remarkPlugins={[remarkGfm]}>{selected.content}</ReactMarkdown></div>
                : <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6">{selected.content}</pre>}
            </div>
          </> : null}
        </> : <div className="grid flex-1 place-content-center gap-3 px-8 text-center"><FolderOpen className="mx-auto size-10 text-stone-300" /><h2 className="text-base font-semibold">从想法到成果</h2><p className="max-w-xs text-sm leading-6 text-stone-500">让 AI 研究问题、分析资料并创建报告、表格或代码。成果会保存在这里，随时预览、下载和继续修改。</p><button className="mt-3 rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm" onClick={() => { onRevise("帮我研究以下主题，核实来源，并制作一份可下载的 Markdown 报告：\n"); onClose(); }}>开始一项研究</button></div>
      ) : tab === "activity" ? <div className="min-h-0 flex-1 overflow-auto p-5">
        <p className="mb-5 text-sm font-medium">{latest?.streamStatus || "任务执行过程会显示在这里"}</p>
        <ol className="space-y-5">{events.map(event => <li key={event.id} className="flex gap-3"><span className="mt-0.5">{event.status === "running" ? <Loader2 className="size-4 animate-spin" /> : event.status === "done" ? <Check className="size-4 text-emerald-600" /> : <span className="block size-3 rounded-full bg-stone-300" />}</span><div><p className="text-sm font-medium">{event.label}</p><p className="mt-1 text-xs leading-5 text-stone-500">{event.detail}</p></div></li>)}</ol>
      </div> : <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">{sources.length ? sources.map((source, i) => <a key={source.url} href={/^https?:\/\//i.test(source.url) ? source.url : undefined} target="_blank" rel="noopener noreferrer" className="block rounded-xl border border-stone-200 bg-white p-4"><p className="flex gap-2 text-sm font-medium"><Globe2 className="size-4 shrink-0" />{i + 1}. {source.title}</p><p className="mt-2 break-all text-xs text-stone-500">{source.displayUrl || source.url}</p><p className="mt-2 text-xs leading-5 text-stone-600">{source.snippet}</p></a>) : <p className="p-5 text-sm text-stone-500">使用联网研究后，引用来源会集中显示在这里。</p>}</div>}
    </aside>
  );
}
