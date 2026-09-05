import assert from "node:assert/strict";
import test from "node:test";
import { resolveSystemPrompt } from "./system-prompt";
import { getChatModel } from "./models";
import type { AiRuntimeSettings } from "./upstream";

const defaults = {
  mode: "default" as const,
  customSystemPrompt: "",
  modelLabel: "GPT-6 Astra",
  promptClock: { date: "2026-09-05", time: "12:30:00", timeZone: "Asia/Singapore" }
};

test("web identity follows the selected model and renders clock placeholders", () => {
  const prompt = resolveSystemPrompt(defaults);
  assert.ok(prompt.includes("我是 GPT-6 Astra，一个 AI 助手。"));
  assert.ok(prompt.includes("2026-09-05（Asia/Singapore）"));
  assert.ok(!prompt.includes("GPT-5.1"));
  assert.ok(!prompt.includes("{model"));
  assert.ok(resolveSystemPrompt({ ...defaults, modelLabel: "GPT-5.6 Terra" }).includes("我是 GPT-5.6 Terra"));
});

test("prompt modes preserve admin custom, append and off semantics", () => {
  assert.equal(resolveSystemPrompt({ ...defaults, mode: "off" }), "");
  assert.equal(resolveSystemPrompt({ ...defaults, mode: "custom", customSystemPrompt: "模型：{model}" }), "模型：GPT-6 Astra");
  assert.equal(resolveSystemPrompt({ ...defaults, mode: "custom", customSystemPrompt: "全局", modelSystemPrompt: "专属：{model_identity}" }), "专属：GPT-6 Astra");
  const appended = resolveSystemPrompt({ ...defaults, mode: "append", customSystemPrompt: "简洁回答", modelSystemPrompt: "使用中文" });
  assert.ok(appended.includes("我是 GPT-6 Astra"));
  assert.ok(appended.endsWith("简洁回答\n\n使用中文"));
});

test("all web Responses variants retain identity instructions, user input and model", async () => {
  process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test?schema=public";
  const { responseBodyVariants } = await import("./upstream");
  const prompt = resolveSystemPrompt(defaults);
  for (const stream of [true, false]) {
    const variants = responseBodyVariants({
      messages: [
        { role: "system", content: prompt },
        { role: "system", content: "用户偏好：简洁" },
        { role: "assistant", content: "我是 Codex，一款基于 GPT-5 的 AI 编程助手。" },
        { role: "user", content: "你是什么模型" }
      ],
      model: getChatModel("GPT-6-Astra"),
      reasoningEffort: "max",
      settings: { reasoningParamMode: "responses" } as AiRuntimeSettings,
      stream,
      webSearch: true
    });
    for (const body of variants) {
      assert.equal(body.instructions, `${prompt}\n\n用户偏好：简洁`);
      assert.equal(body.model, "gpt-6-astra");
      assert.equal(body.stream, stream);
      assert.deepEqual(body.input, [
        { role: "assistant", content: "我是 Codex，一款基于 GPT-5 的 AI 编程助手。" },
        { role: "user", content: "你是什么模型" }
      ]);
    }
  }
});
