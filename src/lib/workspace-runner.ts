import type { ResponsesTools } from "./responses-tools";
import { getChatModel, type ReasoningEffort } from "./models";
import { createResponseStream, responseScope, type AiRuntimeSettings, type UpstreamMessage, type UpstreamUsage } from "./upstream";
import { ARTIFACT_TOOL, createTextArtifact, emptyResponseState, type ResponseItem, type ResponseState, type WorkspaceArtifact } from "./responses-state";
import { readResponsesStream, ResponseStreamError } from "./responses-stream";
import type { PersistedToolEvent } from "./message-process";
import { extractWebSearchCallIds, extractWebSearchSources, type WebSearchSource } from "./web-search";

export function addResponseUsage(total: UpstreamUsage, next?: UpstreamUsage): UpstreamUsage {
  if (!next) return total;
  const sum: Record<string, unknown> = { ...total };
  for (const [key, value] of Object.entries(next)) {
    if (typeof value === "number") sum[key] = (Number(sum[key]) || 0) + value;
    else if (value && typeof value === "object") sum[key] = addResponseUsage((sum[key] || {}) as UpstreamUsage, value as UpstreamUsage);
  }
  return sum;
}

export async function runWorkspace(options: {
  model: string; messages: UpstreamMessage[]; settings: AiRuntimeSettings;
  reasoningEffort: ReasoningEffort; signal: AbortSignal;
  webSearch: boolean; allowCode: boolean; allowArtifacts: boolean;
  nativeTools?: ResponsesTools;
  onArtifact?: (artifact: WorkspaceArtifact) => Promise<WorkspaceArtifact>;
  onToolCost?: (costCents: number) => void;
  fallbackMessages?: () => Promise<UpstreamMessage[]>;
  onText: (delta: string) => void; onReasoning: (delta: string) => void;
  onState: (state: ResponseState) => void; onTool: (event: PersistedToolEvent) => void;
  onSearchCalls: (count: number) => void; onSources: (sources: WebSearchSource[]) => void;
}) {
  const state = emptyResponseState();
  state.scope = responseScope(options.settings, getChatModel(options.model, options.settings.chatModels));
  let usage: UpstreamUsage = {};
  let hasText = false;
  const searches = new Set<string>();
  const starts = new Map<string, number>();
  const billedTools = new Set<string>();
  const nativeTools: Record<string, unknown>[] = options.allowArtifacts ? [ARTIFACT_TOOL] : [];
  const fileIds = [...new Set(options.messages.flatMap(message => typeof message.content === "string" ? [] : message.content.flatMap(part => part.type === "file" && part.file.file_id ? [part.file.file_id] : [])))];
  if (options.allowCode) nativeTools.push({ type: "code_interpreter", container: { type: "auto", ...(fileIds.length ? { file_ids: fileIds } : {}) } });
  if (options.nativeTools?.imageGeneration) nativeTools.push({ type: "image_generation" });
  if (options.nativeTools?.fileSearch && options.nativeTools.sharedVectorStoreIds.length) nativeTools.push({ type: "file_search", vector_store_ids: options.nativeTools.sharedVectorStoreIds, max_num_results: 8 });
  const persistArtifacts = async () => {
    if (!options.onArtifact) return;
    for (let index = 0; index < state.artifacts.length; index++) {
      if (!state.artifacts[index].attachmentId) state.artifacts[index] = await options.onArtifact(state.artifacts[index]);
    }
  };
  const notify = () => options.onState({ ...state, items: [...state.items], artifacts: [...state.artifacts] });
  const emitTool = (item: ResponseItem, finished: boolean) => {
    if (item.type === "message" || item.type === "reasoning") return;
    const id = item.id || String(item.call_id || item.type);
    if (!starts.has(id)) starts.set(id, Date.now());
    const type = item.type === "web_search_call" ? "web_search" : item.type === "image_generation_call" ? "image" : item.type === "code_interpreter_call" ? "file_analysis" : "generation";
    options.onTool({ id, type, label: item.type === "function_call" ? "创建成果" : type === "web_search" ? "联网研究" : type === "file_analysis" ? "代码与数据分析" : "工具执行", startedAt: starts.get(id)!, status: item.status === "failed" ? "error" : finished && item.type !== "function_call" ? "done" : "running", ...(finished ? { finishedAt: Date.now() } : {}) });
  };
  try {
    for (let turn = 0; turn < 12; turn++) {
      options.signal.throwIfAborted();
      const prefix = [...state.items];
      const body = await createResponseStream(options.model, options.messages, options.settings, {
        reasoningEffort: options.reasoningEffort, signal: options.signal, webSearch: options.webSearch,
        nativeTools, nativeState: true, continuationItems: prefix, fallbackMessages: options.fallbackMessages
      });
      let result;
      let firstText = true;
      try {
        result = await readResponsesStream(body, {
          signal: options.signal, onText: delta => {
            if (firstText && hasText && delta) options.onText("\n\n");
            if (delta) { firstText = false; hasText = true; options.onText(delta); }
          }, onReasoning: options.onReasoning,
          onEvent: event => {
            const response = event.response as Record<string, unknown> | undefined;
            if (typeof response?.id === "string") state.responseId = response.id;
            const calls = extractWebSearchCallIds(event).filter(id => !searches.has(id));
            calls.forEach(id => searches.add(id));
            if (calls.length) options.onSearchCalls(calls.length);
            const sources = extractWebSearchSources(event);
            if (sources.length) options.onSources(sources);
            if (event.type === "response.output_item.added" || event.type === "response.output_item.done") {
              const item = event.item as ResponseItem;
              if (!item?.type) return;
              emitTool(item, event.type === "response.output_item.done");
              if (event.type === "response.output_item.done") {
                const index = item.id ? state.items.findIndex(existing => existing.id === item.id) : -1;
                if (index >= 0) state.items[index] = item; else state.items.push(item);
                notify();
              }
            }
          }
        });
      } catch (error) {
        if (error instanceof ResponseStreamError) {
          state.items = [...prefix, ...error.result.items];
          usage = addResponseUsage(usage, error.result.usage);
        }
        throw error;
      }
      state.responseId = result.id;
      state.items = [...prefix, ...result.items];
      usage = addResponseUsage(usage, result.usage);
      for (const item of result.items) {
        emitTool(item, true);
        const billingKey = item.type === "code_interpreter_call" ? String(item.container_id || item.id) : item.id;
        const cost = item.type === "code_interpreter_call" ? options.nativeTools?.codeSessionCostCents : item.type === "image_generation_call" ? options.nativeTools?.imageCostCents : item.type === "file_search_call" ? options.nativeTools?.fileSearchCostCents : 0;
        if (billingKey && !billedTools.has(billingKey) && cost && item.status !== "failed") {
          billedTools.add(billingKey);
          options.onToolCost?.(cost);
        }
        if (item.type === "image_generation_call" && typeof item.result === "string") {
          if (item.result.length > 20_000_000 || !/^[A-Za-z0-9+/=\r\n]+$/.test(item.result)) throw new Error("上游图片数据无效或超过大小限制。");
          const format = item.output_format === "jpeg" ? "jpeg" : item.output_format === "webp" ? "webp" : "png";
          state.artifacts.push({ id: item.id || `image-${state.artifacts.length}`, title: "生成图片", filename: `image-${state.artifacts.length + 1}.${format}`, mimeType: `image/${format}`, imageData: item.result });
        }
        if (!Array.isArray(item.content)) continue;
        for (const part of item.content) {
          for (const annotation of part.annotations || []) {
            if (annotation.type !== "container_file_citation" || !annotation.file_id || !annotation.container_id) continue;
            const id = String(annotation.file_id);
            if (!state.artifacts.some(artifact => artifact.id === id)) state.artifacts.push({ id, title: annotation.filename || "生成文件", filename: annotation.filename || "result", mimeType: "application/octet-stream", fileId: id, containerId: annotation.container_id });
          }
        }
      }
      await persistArtifacts();
      const calls = result.items.filter(item => item.type === "function_call");
      if (!calls.length) { state.status = "completed"; notify(); return { state, usage }; }
      for (const call of calls) {
        let output: Record<string, unknown>;
        try {
          if (call.name !== "create_artifact" || !options.allowArtifacts) throw new Error("工具未获授权或不受支持。");
          let artifact = createTextArtifact(JSON.parse(String(call.arguments)), String(call.call_id));
          if (state.artifacts.length >= 24) throw new Error("单次任务最多创建 24 个成果。");
          if (state.artifacts.reduce((sum, item) => sum + (item.content?.length || 0), 0) + (artifact.content?.length || 0) > 2_000_000) throw new Error("本轮成果超过总大小限制，请分轮创建。");
          if (options.onArtifact) artifact = await options.onArtifact(artifact);
          state.artifacts.push(artifact);
          output = { success: true, artifact_id: artifact.id, filename: artifact.filename, message: "成果已保存到工作台，用户可以预览和下载。" };
        } catch (error) { output = { success: false, error: error instanceof Error ? error.message : "无法创建成果" }; }
        options.onTool({ id: call.id || String(call.call_id), type: "generation", label: "创建成果", startedAt: starts.get(call.id || String(call.call_id)) || Date.now(), finishedAt: Date.now(), status: output.success ? "done" : "error", detail: String(output.filename || output.error || "") });
        state.items.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(output) });
      }
      notify();
    }
    throw new Error("本轮达到工具执行次数上限，已保存成果，可以继续任务。");
  } catch (error) {
    state.status = options.signal.aborted ? "cancelled" : error instanceof ResponseStreamError && error.result.status === "incomplete" ? "incomplete" : "failed";
    notify();
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { workspaceUsage: usage });
  }
}
