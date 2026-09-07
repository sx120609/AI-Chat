import assert from "node:assert/strict";
import test from "node:test";
import { readResponsesStream, ResponseStreamError } from "./responses-stream";
import { createTextArtifact, replayResponseItems, emptyResponseState, responseView, type ResponseItem } from "./responses-state";
import { buildContextMessages } from "./context-window";
import { CHAT_MODELS } from "./models";
import { normalizeResponsesTools, toolsForModel } from "./responses-tools";

function stream(events: unknown[], chunkSize = 7) {
  const bytes = new TextEncoder().encode(events.map(event => typeof event === "string" ? event : `data: ${JSON.stringify(event)}\r\n\r\n`).join(""));
  return new ReadableStream<Uint8Array>({ start(controller) { for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize)); controller.close(); } });
}

async function read(events: unknown[]) {
  let text = ""; let reasoning = "";
  const result = await readResponsesStream(stream(events), { onText: delta => { text += delta; }, onReasoning: delta => { reasoning += delta; }, onEvent: () => {} });
  return { text, reasoning, result };
}

test("native stream keeps output order, commentary, reasoning and exact Unicode without terminal duplication", async () => {
  const items: ResponseItem[] = [
    { id: "reason", type: "reasoning", encrypted_content: "opaque-private", summary: [{ type: "summary_text", text: "核实资料" }] },
    { id: "m1", type: "message", phase: "commentary", content: [{ type: "output_text", text: "开始研究。" }] },
    { id: "m2", type: "message", phase: "final_answer", content: [{ type: "output_text", text: "完成 ✅" }] }
  ];
  const output = await read([
    { type: "response.created", response: { id: "resp_1" } },
    { type: "response.reasoning_summary_text.delta", delta: "核实资料" },
    { type: "response.output_text.delta", output_index: 1, delta: "开始研究。" },
    { type: "response.output_text.delta", output_index: 2, delta: "完成 ✅" },
    { type: "response.completed", response: { id: "resp_1", status: "completed", output: items, usage: { input_tokens: 10, output_tokens: 20 } } }
  ]);
  assert.equal(output.text, "开始研究。\n\n完成 ✅");
  assert.equal(output.reasoning, "核实资料");
  assert.deepEqual(output.result.items, items);
  assert.equal(output.result.usage?.input_tokens, 10);
  const view = responseView({ ...emptyResponseState(), items });
  assert.ok(!JSON.stringify(view).includes("opaque-private"));
  assert.equal(view.steps[0].text, "开始研究。");
});

test("only a terminal completed event confirms a native task", async () => {
  await assert.rejects(read([{ type: "response.output_text.delta", delta: "部分结果" }, "data: [DONE]\n\n"]), /未确认完成/);
  await assert.rejects(read([{ type: "response.incomplete", response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, usage: { output_tokens: 88 } } }]), error => error instanceof ResponseStreamError && error.result.usage?.output_tokens === 88);
  await assert.rejects(read([{ type: "response.failed", response: { error: { message: "tool failed" } } }]), /tool failed/);
  await assert.rejects(read(["data: {broken}\n\n"]), /损坏/);
});

test("nonstream native output and compatibility completions both retain visible text", async () => {
  assert.equal((await read([{ type: "response.completed", response: { output: [{ type: "message", content: [{ type: "refusal", refusal: "无法执行" }] }] } }])).text, "无法执行");
  assert.equal((await read([{ choices: [{ message: { content: "兼容回复" } }] }, "data: [DONE]\n\n"])).text, "兼容回复");
});

test("abort interrupts a stalled native stream", async () => {
  const controller = new AbortController();
  const reading = readResponsesStream(new ReadableStream(), { signal: controller.signal, onText: () => {}, onReasoning: () => {}, onEvent: () => {} });
  controller.abort();
  await assert.rejects(reading, /abort/i);
});

test("text artifacts cannot masquerade as binary files or escape filenames", () => {
  const artifact = createTextArtifact({ title: "研究报告", filename: "../../report.md", content: "# 结论\n可靠来源" }, "call_1");
  assert.equal(artifact.filename, "report.md");
  assert.equal(artifact.mimeType, "text/markdown");
  assert.throws(() => createTextArtifact({ title: "假 PDF", filename: "report.pdf", content: "plain text" }, "id"), /二进制/);
  assert.throws(() => createTextArtifact({ title: "超大", filename: "big.txt", content: "a".repeat(500001) }, "id"), /500,000/);
});

test("context budget drops complete old turns and reports actual model capacity", () => {
  const model = { ...CHAT_MODELS[0], contextWindowTokens: 4096 };
  const context = buildContextMessages({ model, systemPrompt: "You help.", userContent: "最新问题", previousMessages: [
    { role: "ASSISTANT", content: "最新答案" }, { role: "USER", content: "上个问题" },
    { role: "ASSISTANT", content: "x".repeat(16000) }, { role: "USER", content: "旧问题" }
  ] });
  assert.equal(context.contextStats.contextWindowTokens, 4096);
  assert.equal(context.contextStats.omittedMessageCount, 2);
  assert.deepEqual(context.upstreamMessages.map(message => message.role), ["system", "user", "assistant", "user"]);
  assert.throws(() => buildContextMessages({ model, systemPrompt: "", userContent: "字".repeat(5000), previousMessages: [] }), /超过/);
});

test("hosted tools require explicit enablement and model allowlists apply", () => {
  const tools = normalizeResponsesTools({ codeInterpreter: true, imageCostCents: -10, modelIds: ["gpt-test"], sharedVectorStoreIds: ["vs_public", "bad"] });
  assert.equal(tools.imageGeneration, false);
  assert.equal(tools.imageCostCents, 0);
  assert.deepEqual(tools.sharedVectorStoreIds, ["vs_public"]);
  assert.equal(toolsForModel(tools, "other", "other").artifacts, false);
  assert.equal(toolsForModel(tools, "gpt-test", "other").codeInterpreter, true);
});

test("request variants retain native state only for the same provider and never change storage policy", async () => {
  process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test";
  const { responseBodyVariants, responseScope } = await import("./upstream");
  const settings = { apiBaseUrl: "https://example.invalid/v1", apiKey: "test", orgId: "", reasoningParamMode: "responses" } as import("./upstream").AiRuntimeSettings;
  const model = CHAT_MODELS[0];
  const native = [{ type: "message", id: "m_native", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text: "原生回复" }] }];
  const variants = responseBodyVariants({ model, settings, stream: true, reasoningEffort: "medium", nativeState: true, messages: [
    { role: "assistant", content: "原生回复", responseItems: native, responseScope: responseScope(settings, model) },
    { role: "user", content: "继续" }
  ] });
  for (const variant of variants) { assert.equal(variant.store, false); assert.equal((variant.input as ResponseItem[])[0].id, "m_native"); }
  const migrated = responseBodyVariants({ model, settings: { ...settings, apiKey: "changed-provider-key" }, stream: true, reasoningEffort: "medium", messages: [{ role: "assistant", content: "文字兜底", responseItems: native, responseScope: responseScope(settings, model) }] });
  assert.equal((migrated[0].input as ResponseItem[])[0].id, undefined);
});


test("interrupted function calls never produce orphaned tool state on continuation", () => {
  const replay = replayResponseItems([
    { type: "function_call", call_id: "interrupted", status: "completed", name: "create_artifact", arguments: "{}" },
    { type: "function_call", call_id: "partial", status: "in_progress", arguments: "{" },
    { type: "function_call_output", call_id: "orphan", output: "unmatched" }
  ]);
  assert.deepEqual(replay.map(item => item.type), ["function_call", "function_call_output"]);
  assert.equal(replay[1].call_id, "interrupted");
  assert.equal(JSON.parse(String(replay[1].output)).success, false);
});

test("terminal fallback matches item IDs without duplicating streamed text", async () => {
  const output = await read([
    { type: "response.output_text.delta", item_id: "m-id", delta: "唯一正文" },
    { type: "response.completed", response: { output: [{ type: "message", id: "m-id", content: [{ type: "output_text", text: "唯一正文" }] }] } }
  ]);
  assert.equal(output.text, "唯一正文");
});
