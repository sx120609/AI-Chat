import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CCSwitchDialog } from "./cc-switch-dialog";

test("renders all New API style app choices without exposing the full API key", () => {
  const html = renderToStaticMarkup(
    <CCSwitchDialog
      apiKey={{
        active: true,
        apiKey: "sk-user-full-secret",
        canReveal: true,
        createdAt: "2026-08-22T00:00:00.000Z",
        id: "key-1",
        keyPrefix: "sk-user-prefix",
        name: "开发机",
        usageCostLimitCents: 0,
        usageCostRemainingCents: null,
        usageCostUsedCents: 0
      }}
      models={[
        {
          cachedInputCentsPerMillionTokens: 50,
          contextNote: "Sol",
          contextWindowTokens: 1_000_000,
          enabled: true,
          id: "gpt-5.6-sol",
          inputCentsPerMillionTokens: 500,
          label: "GPT-5.6 Sol",
          maxContextWindowTokens: 1_000_000,
          outputCentsPerMillionTokens: 3000,
          source: "default",
          supportsReasoning: true,
          upstreamId: "gpt-5.6-sol"
        }
      ]}
      onClose={() => undefined}
      serverAddress="https://chat.example.com"
    />
  );

  assert.match(html, /导入到 CC Switch/);
  assert.match(html, /Claude/);
  assert.match(html, /Codex/);
  assert.match(html, /Gemini/);
  assert.match(html, /Haiku 模型/);
  assert.match(html, /sk-user-prefix/);
  assert.doesNotMatch(html, /sk-user-full-secret/);
});
