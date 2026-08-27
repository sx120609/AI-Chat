import assert from "node:assert/strict";
import test from "node:test";
import {
  codingPlanSnapshot,
  normalizeCodingPlanConfig,
  parseCodingPlanOrderSnapshot,
  validateCodingPlans
} from "./coding-plan";
import { nextQuotaResetAt } from "./quota";

test("keeps configurable Coding Plan duration in payment snapshots", () => {
  const plan = normalizeCodingPlanConfig({
    id: "pro-3m",
    name: "Pro 三月包",
    description: "三个月套餐",
    durationMonths: 3,
    enabled: true,
    monthlyCostLimitCents: 2500,
    personalApiEnabled: true,
    priceCents: 4990
  });
  const snapshot = codingPlanSnapshot(plan);
  const parsed = parseCodingPlanOrderSnapshot(
    JSON.stringify({ productType: "CODING_PLAN", codingPlan: snapshot })
  );

  assert.equal(parsed?.durationMonths, 3);
  assert.equal(parsed?.id, "pro-3m");
  assert.equal(nextQuotaResetAt(new Date("2026-01-31T12:00:00.000Z"), 3).toISOString(), "2026-04-30T12:00:00.000Z");
});

test("rejects duplicate or malformed Coding Plan ids instead of silently dropping plans", () => {
  const base = {
    name: "Plan",
    description: "Plan",
    durationMonths: 1,
    enabled: true,
    monthlyCostLimitCents: 1000,
    dailyCostLimitCents: 0,
    weeklyCostLimitCents: 0,
    personalApiEnabled: false,
    priceCents: 100
  };

  assert.throws(
    () => validateCodingPlans([{ ...base, id: "same" }, { ...base, id: "same" }]),
    /重复/
  );
  assert.throws(
    () => validateCodingPlans([{ ...base, id: "包含空格" }]),
    /ID 无效/
  );
  assert.throws(
    () => validateCodingPlans([{ ...base, id: "bad-limits", dailyCostLimitCents: 1200 }]),
    /每日限额不能高于每月额度/
  );
});
