import assert from "node:assert/strict";
import test from "node:test";
import {
  activeBillingMultiplier,
  billedCostCents,
  validateBillingMultiplierSchedule
} from "./billing-multiplier";

test("uses the configured multiplier only inside its time window", () => {
  const schedule = validateBillingMultiplierSchedule({
    billingMultiplier: 0,
    billingMultiplierStartsAt: "2026-08-23T00:00:00.000Z",
    billingMultiplierEndsAt: "2026-08-24T00:00:00.000Z"
  });

  assert.equal(activeBillingMultiplier(schedule, new Date("2026-08-23T12:00:00.000Z")), 0);
  assert.equal(activeBillingMultiplier(schedule, new Date("2026-08-24T00:00:00.000Z")), 1);
  assert.equal(billedCostCents(12.345, 0), 0);
  assert.equal(billedCostCents(12.345, 0.5), 6.1725);
});

test("rejects an inverted multiplier window", () => {
  assert.throws(
    () =>
      validateBillingMultiplierSchedule({
        billingMultiplier: 0.5,
        billingMultiplierStartsAt: "2026-08-24T00:00:00.000Z",
        billingMultiplierEndsAt: "2026-08-23T00:00:00.000Z"
      }),
    /结束时间必须晚于开始时间/
  );
});
