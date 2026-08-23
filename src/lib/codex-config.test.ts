import assert from "node:assert/strict";
import test from "node:test";
import { buildCodexAuthRepairCommand, buildCodexConfig } from "./codex-config";

test("builds a Codex 0.149 compatible authenticated provider config", () => {
  const config = buildCodexConfig({
    baseUrl: "https://chat.example.com/v1/",
    model: "gpt-5.6-sol",
    siteName: 'Team "AI"'
  });

  assert.match(config, /model_provider = "lowiq"/);
  assert.match(config, /name = "Team \\"AI\\""/);
  assert.match(config, /base_url = "https:\/\/chat\.example\.com\/v1"/);
  assert.match(config, /env_key = "LOWIQ_API_KEY"/);
  assert.match(config, /requires_openai_auth = true/);
  assert.match(config, /supports_standalone_web_search = true/);
  assert.match(config, /web_search = "live"/);
  assert.doesNotMatch(config, /^network_access\s*=/m);
});

test("builds scoped repair commands that back up existing Codex config", () => {
  const windows = buildCodexAuthRepairCommand({
    baseUrl: "https://chat.example.com/v1",
    os: "windows"
  });
  const unix = buildCodexAuthRepairCommand({
    baseUrl: "https://chat.example.com/v1",
    os: "unix"
  });

  for (const command of [windows, unix]) {
    assert.match(command, /chat\.example\.com\/v1/);
    assert.match(command, /requires_openai_auth = true/);
    assert.match(command, /bak-/);
    assert.match(command, /model_providers/);
  }
});
