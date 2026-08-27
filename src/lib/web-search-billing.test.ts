import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateWebSearchCostCents,
  DEFAULT_WEB_SEARCH_COST_CENTS,
  normalizeWebSearchCostCents
} from "./web-search-billing";

test("defaults web search billing to one cent per call", () => {
  assert.equal(normalizeWebSearchCostCents(undefined), DEFAULT_WEB_SEARCH_COST_CENTS);
  assert.equal(calculateWebSearchCostCents(3, undefined), 3);
});

test("supports a configurable fractional per-call web search fee", () => {
  assert.equal(normalizeWebSearchCostCents(1.25), 1.25);
  assert.equal(calculateWebSearchCostCents(2, 1.25), 2.5);
});

test("never produces a negative web search fee", () => {
  assert.equal(normalizeWebSearchCostCents(-5), 0);
  assert.equal(calculateWebSearchCostCents(-2, 1), 0);
});
