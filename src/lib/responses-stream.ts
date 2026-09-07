import { itemText, type ResponseItem } from "./responses-state";
import type { UpstreamUsage } from "./upstream";

export type NativeStreamResult = { id?: string; status: string; items: ResponseItem[]; usage?: UpstreamUsage };
export class ResponseStreamError extends Error {
  constructor(message: string, public result: NativeStreamResult) { super(message); }
}

export async function readResponsesStream(body: ReadableStream<Uint8Array>, handlers: {
  onText: (text: string) => void;
  onReasoning: (text: string) => void;
  onEvent: (event: Record<string, unknown>) => void;
  signal?: AbortSignal;
}): Promise<NativeStreamResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let native = false;
  let terminal = false;
  let compatibilityDone = false;
  const streamedItems = new Set<string>();
  let lastTextItem: string | undefined;
  const emitText = (key: string, text: string) => {
    if (!text) return;
    if (lastTextItem !== undefined && lastTextItem !== key) handlers.onText("\n\n");
    handlers.onText(text);
    lastTextItem = key;
  };
  const output = new Map<number, ResponseItem>();
  const result: NativeStreamResult = { status: "in_progress", items: [] };
  const processBlock = (block: string) => {
    const data = block.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!data) return;
    if (data === "[DONE]") { compatibilityDone = true; return; }
    let event: Record<string, unknown> & {
      type?: string; delta?: string; output_index?: number; item_id?: string;
      item?: ResponseItem; usage?: UpstreamUsage; message?: string;
      error?: { message?: string };
      response?: { id?: string; status?: string; usage?: UpstreamUsage; output?: ResponseItem[]; error?: { message?: string }; incomplete_details?: { reason?: string } };
      choices?: Array<{ delta?: { content?: string; reasoning_content?: string }; message?: { content?: string }; finish_reason?: string }>;
    };
    try { event = JSON.parse(data); } catch { throw new ResponseStreamError("上游返回了损坏的流事件。", result); }
    const type = typeof event.type === "string" ? event.type : "";
    if (type.startsWith("response.")) native = true;
    if (event.response?.id) result.id = event.response.id;
    if (event.usage || event.response?.usage) result.usage = event.usage || event.response?.usage;
    if (type === "response.output_text.delta" || type === "response.refusal.delta") {
      const key = String(event.output_index ?? event.item_id ?? "0");
      streamedItems.add(key);
      if (event.item_id) streamedItems.add(event.item_id);
      if (typeof event.delta === "string") emitText(key, event.delta);
    }
    if ((type === "response.reasoning_summary_text.delta" || type === "response.reasoning_text.delta") && typeof event.delta === "string") handlers.onReasoning(event.delta);
    if ((type === "response.output_item.added" || type === "response.output_item.done") && event.item?.type) {
      output.set(event.output_index ?? output.size, event.item);
      result.items = [...output.entries()].sort(([a], [b]) => a - b).map(([, item]) => item);
    }
    if (!type && Array.isArray(event.choices)) {
      for (const choice of event.choices) {
        if (choice.delta?.content || choice.message?.content) handlers.onText(choice.delta?.content || choice.message?.content || "");
        if (choice.delta?.reasoning_content) handlers.onReasoning(choice.delta.reasoning_content);
        if (choice.finish_reason) compatibilityDone = true;
      }
    }
    if (["response.completed", "response.failed", "response.incomplete"].includes(type)) {
      terminal = true;
      result.status = event.response?.status || type.slice(9);
      if (Array.isArray(event.response?.output)) result.items = event.response.output;
      for (const [index, item] of result.items.entries()) {
        if (item.type === "message" && !streamedItems.has(String(index)) && !(item.id && streamedItems.has(item.id))) {
          const text = itemText(item);
          if (text) emitText(String(index), text);
        }
      }
    }
    handlers.onEvent(event);
    if (type === "error" || type === "response.failed" || event.error) throw new ResponseStreamError(event.error?.message || event.response?.error?.message || event.message || "上游任务失败。", result);
    if (type === "response.incomplete") throw new ResponseStreamError(`任务尚未完成：${event.response?.incomplete_details?.reason || "输出达到限制"}。可以继续生成。`, result);
  };
  const abort = () => { void reader.cancel(); };
  handlers.signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      handlers.signal?.throwIfAborted();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const next = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ResponseStreamError("上游超过五分钟没有返回新事件。", result)), 300_000); })
      ]).finally(() => clearTimeout(timer));
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true });
      if (buffer.length > 24_000_000) throw new ResponseStreamError("上游事件超过大小限制。", result);
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || "";
      blocks.forEach(processBlock);
    }
    buffer += decoder.decode();
    if (buffer.trim()) processBlock(buffer);
    handlers.signal?.throwIfAborted();
    if ((native && !terminal) || (!native && !compatibilityDone)) throw new ResponseStreamError("连接提前结束，任务未确认完成，已保留部分结果。", result);
    if (!native) result.status = "completed";
    return result;
  } finally {
    handlers.signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
