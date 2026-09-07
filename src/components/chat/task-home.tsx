"use client";

import { ArrowUpRight, ChevronRight, FileText, FolderOpen, Loader2, PenLine, Search, Sparkles } from "lucide-react";
import type { ConversationSummary } from "@/types/gateway";

const shortcuts = [
  { icon: Search, label: "研究问题", detail: "查资料 · 核实来源", prompt: "帮我研究以下主题，核实关键事实与来源，并整理一份报告：\n" },
  { icon: FileText, label: "分析文件", detail: "读资料 · 提炼结论", prompt: "请分析我上传的资料，提炼关键结论，并制作可下载的报告和数据表。" },
  { icon: PenLine, label: "写作创作", detail: "写初稿 · 反复打磨", prompt: "请根据以下目标创作完整内容，整理成可下载的文档：\n" },
  { icon: Sparkles, label: "梳理方案", detail: "拆问题 · 定下一步", prompt: "帮我把下面的问题整理成清晰、可执行的方案：\n" }
];

export function TaskHome({ conversations, runningKeys, onPrompt, onOpen, onHistory }: {
  conversations: ConversationSummary[];
  runningKeys: ReadonlySet<string>;
  onPrompt: (prompt: string) => void;
  onOpen: (id: string) => void;
  onHistory: () => void;
}) {
  const recent = conversations.slice(0, 4);
  return <div className="task-home">
    <section className="task-home-entry" aria-label="任务快捷入口">
      <div className="task-home-heading"><span className="task-home-mark"><Sparkles size={22} /></span><div><p>你的 AI 工作伙伴</p><h1>今天，想完成什么？</h1></div></div>
      <p className="task-home-intro">从一个问题开始，把想法变成看得见的成果。</p>
      <div className="task-quick-grid">{shortcuts.map(({ icon: Icon, label, detail, prompt }) => <button key={label} type="button" onClick={() => onPrompt(prompt)}><Icon aria-hidden="true" /><strong>{label}</strong><span>{detail}</span></button>)}</div>
    </section>
    <section className="task-home-recent" aria-label="最近任务">
      <header><div><h2>继续上次的任务</h2><p>研究、资料与创作，随时接着做</p></div><button type="button" onClick={onHistory}>全部 <ChevronRight size={14} /></button></header>
      {recent.length ? <div className="task-home-list">{recent.map(conversation => <button key={conversation.id} type="button" onClick={() => onOpen(conversation.id)}><span className="task-recent-icon">{runningKeys.has(conversation.id) ? <Loader2 className="animate-spin" size={18} /> : <FolderOpen size={18} />}</span><span className="task-recent-copy"><strong>{conversation.title}</strong><small>{runningKeys.has(conversation.id) ? "正在进行" : "打开任务，继续完善"}</small></span><ArrowUpRight size={16} /></button>)}</div> : <div className="task-home-empty"><FolderOpen size={24} /><p>还没有任务</p><span>在下方描述目标，或选择上面的快捷入口。</span></div>}
    </section>
  </div>;
}
