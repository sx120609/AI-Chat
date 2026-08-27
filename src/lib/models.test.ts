import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChatModelCatalog,
  getEnabledChatModels,
  getVisibleChatModels
} from "./models";

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
