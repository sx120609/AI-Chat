import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireUserApiConcurrency,
  normalizeUserApiConcurrencyLimit,
  releaseUserApiConcurrency
} from "./user-api-concurrency";

test("normalizes the configured personal API concurrency limit", () => {
  assert.equal(normalizeUserApiConcurrencyLimit(0), 0);
  assert.equal(normalizeUserApiConcurrencyLimit("3"), 3);
  assert.equal(normalizeUserApiConcurrencyLimit(-2), 0);
  assert.equal(normalizeUserApiConcurrencyLimit(5000), 1000);
});

test("rejects a second lease until the first personal API slot is released", async () => {
  const userId = `test-${crypto.randomUUID()}`;
  const first = await acquireUserApiConcurrency(userId, 1);

  assert.ok(first);
  assert.equal(await acquireUserApiConcurrency(userId, 1), null);

  await releaseUserApiConcurrency(first);
  const next = await acquireUserApiConcurrency(userId, 1);

  assert.ok(next);
  await releaseUserApiConcurrency(next);
});
