import assert from "node:assert/strict";
import test from "node:test";
import { buildCCSwitchImportUrl } from "./cc-switch";

function importParams(url: string) {
  return new URL(url).searchParams;
}

test("builds a Codex provider deep link with the OpenAI v1 endpoint", () => {
  const url = buildCCSwitchImportUrl({
    app: "codex",
    apiKey: "sk-user-secret",
    models: { model: "gpt-5.6-sol" },
    name: "Team Codex",
    serverAddress: "https://chat.example.com/"
  });
  const params = importParams(url);

  assert.equal(url.startsWith("ccswitch://v1/import?"), true);
  assert.equal(params.get("resource"), "provider");
  assert.equal(params.get("app"), "codex");
  assert.equal(params.get("name"), "Team Codex");
  assert.equal(params.get("endpoint"), "https://chat.example.com/v1");
  assert.equal(params.get("apiKey"), "sk-user-secret");
  assert.equal(params.get("model"), "gpt-5.6-sol");
  assert.equal(params.get("homepage"), "https://chat.example.com");
  assert.equal(params.get("enabled"), "true");
});

test("includes Claude model aliases and omits empty values", () => {
  const params = importParams(
    buildCCSwitchImportUrl({
      app: "claude",
      apiKey: " sk-user-secret ",
      models: {
        model: "main/model",
        haikuModel: " fast model ",
        sonnetModel: "",
        opusModel: "strong&model"
      },
      name: " 我的 Claude ",
      serverAddress: "https://chat.example.com/gateway/?ignored=1#ignored"
    })
  );

  assert.equal(params.get("name"), "我的 Claude");
  assert.equal(params.get("endpoint"), "https://chat.example.com/gateway");
  assert.equal(params.get("apiKey"), "sk-user-secret");
  assert.equal(params.get("model"), "main/model");
  assert.equal(params.get("haikuModel"), "fast model");
  assert.equal(params.has("sonnetModel"), false);
  assert.equal(params.get("opusModel"), "strong&model");
});

test("rejects non-http provider endpoints", () => {
  assert.throws(
    () =>
      buildCCSwitchImportUrl({
        app: "gemini",
        apiKey: "sk-user-secret",
        models: { model: "gemini-model" },
        name: "My Gemini",
        serverAddress: "file:///tmp/gateway"
      }),
    /HTTP 或 HTTPS/
  );
});
