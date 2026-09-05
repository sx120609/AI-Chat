import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChatModelCatalog,
  estimateChatCostForModel,
  getChatModel,
  getEnabledApiModels,
  getCodexReasoningLevels,
  normalizeReasoningEffortForModel,
  getEnabledChatModels,
  getVisibleChatModels
} from "./models";

test("Astra supports chat and API discovery without changing the default model", () => {
  const catalog = buildChatModelCatalog({
    availableModelsJson: JSON.stringify(["gpt-6-astra"])
  });
  const astra = getChatModel("gpt-6-astra", catalog);
  assert.equal(catalog[0].id, "GPT-5.6-Sol");
  assert.equal(astra.id, "GPT-6-Astra");
  assert.equal(astra.supportsReasoning, true);
  assert.ok(getVisibleChatModels(catalog).includes(astra));
  assert.equal(getEnabledApiModels(catalog).filter((m) => m.id === "gpt-6-astra").length, 1);
  assert.deepEqual(getCodexReasoningLevels(astra).map((l) => l.effort), ["low", "medium", "high", "xhigh", "max"]);
  assert.equal(normalizeReasoningEffortForModel("max", astra), "max");
  assert.equal(normalizeReasoningEffortForModel("none", astra), "low");
  assert.equal(normalizeReasoningEffortForModel("max", "gpt-5.4"), "xhigh");
  assert.equal(estimateChatCostForModel(astra, 100_000, 10_000, 50_000), 105);
});

test("existing admin allowlists retain control over Astra availability", () => {
  const catalog = buildChatModelCatalog({
    enabledChatModelsJson: JSON.stringify(["GPT-5.6-Sol", "GPT-6-Astra"]),
    visibleChatModelsJson: JSON.stringify(["GPT-5.6-Sol"])
  });
  assert.ok(getEnabledApiModels(catalog).some((m) => m.id === "gpt-6-astra"));
  assert.ok(!getVisibleChatModels(catalog).some((m) => m.id === "GPT-6-Astra"));
  assert.ok(!getEnabledApiModels(buildChatModelCatalog({
    enabledChatModelsJson: JSON.stringify(["GPT-5.6-Sol"])
  })).some((m) => m.id === "gpt-6-astra"));
});

test("enabled models can be hidden from the chat selector independently", () => {
  const catalog = buildChatModelCatalog({
    enabledChatModelsJson: JSON.stringify(["GPT-5.6-Sol", "GPT-5.5"]),
    visibleChatModelsJson: JSON.stringify(["GPT-5.6-Sol"])
  });

  assert.deepEqual(
    getEnabledChatModels(catalog).map((model) => model.id),
    ["GPT-5.6-Sol", "GPT-5.5"]
  );
  assert.deepEqual(
    getVisibleChatModels(catalog).map((model) => model.id),
    ["GPT-5.6-Sol"]
  );
});

test("legacy settings keep every enabled model visible in chat", () => {
  const catalog = buildChatModelCatalog({
    enabledChatModelsJson: JSON.stringify(["GPT-5.6-Sol", "GPT-5.5"]),
    visibleChatModelsJson: "[]"
  });

  assert.deepEqual(
    getVisibleChatModels(catalog).map((model) => model.id),
    ["GPT-5.6-Sol", "GPT-5.5"]
  );
});
