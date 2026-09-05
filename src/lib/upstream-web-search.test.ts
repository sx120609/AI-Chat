import assert from "node:assert/strict";
import test from "node:test";
import { CHAT_MODELS } from "./models";
import type { AiRuntimeSettings } from "./upstream";

test("Astra Responses requests preserve Max and web search", async () => {
  process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test?schema=public";
  const { responseBodyVariants } = await import("./upstream");
  const model = CHAT_MODELS.find((item) => item.id === "GPT-6-Astra")!;
  const variants = responseBodyVariants({
    messages: [{ role: "user", content: "latest news" }],
    model,
    reasoningEffort: "max",
    settings: { reasoningParamMode: "responses" } as AiRuntimeSettings,
    stream: true,
    webSearch: true
  });
  assert.equal(variants[0].model, "gpt-6-astra");
  assert.deepEqual(variants[0].reasoning, { effort: "max" });
  assert.equal(variants[0].temperature, undefined);
  for (const variant of variants) {
    assert.deepEqual(variant.tools, [{ type: "web_search" }]);
  }
});

test("keeps the Sub2API web_search tool in every Responses fallback", async () => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL || "postgresql://test:test@127.0.0.1:5432/test?schema=public";
  const { responseBodyVariants } = await import("./upstream");
  const model = CHAT_MODELS[0];

  assert.ok(model);

  const variants = responseBodyVariants({
    messages: [{ role: "user", content: "latest news" }],
    model,
    reasoningEffort: "medium",
    settings: { reasoningParamMode: "responses" } as AiRuntimeSettings,
    stream: true,
    webSearch: true
  });

  assert.ok(variants.length >= 2);

  for (const variant of variants) {
    assert.deepEqual(variant.tools, [{ type: "web_search" }]);
  }

  assert.deepEqual(variants[0]?.include, ["web_search_call.action.sources"]);
  assert.equal(variants.at(-1)?.include, undefined);
});
