import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptRedemptionCode,
  encryptRedemptionCode,
  generateRedemptionCode,
  hashRedemptionCode,
  normalizeRedemptionCode,
  serializeRedemptionReward
} from "./redemption-codes";

test("normalizes human-entered redemption codes and hashes equivalent forms equally", () => {
  const code = "LOWIQ-ABCD-2345-WXYZ";

  assert.equal(normalizeRedemptionCode(" lowiq abcd-2345-wxyz "), "LOWIQABCD2345WXYZ");
  assert.equal(hashRedemptionCode(code), hashRedemptionCode("lowiq abcd 2345 wxyz"));
});

test("generates displayable codes and encrypts them for admin readback", () => {
  const code = generateRedemptionCode("school");
  const encrypted = encryptRedemptionCode(code);

  assert.match(code, /^SCHOOL-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(decryptRedemptionCode(encrypted), code);
});

test("parses point and Coding Plan redemption rewards", () => {
  const points = serializeRedemptionReward({
    aiPointsBalanceCents: 1200,
    codingPlanSnapshotJson: "{}",
    rewardType: "AI_POINTS"
  });
  const plan = serializeRedemptionReward({
    aiPointsBalanceCents: 0,
    codingPlanSnapshotJson: JSON.stringify({
      id: "gift-plan",
      name: "赠送套餐",
      description: "兑换码套餐",
      durationMonths: 2,
      monthlyCostLimitCents: 2000,
      dailyCostLimitCents: 0,
      weeklyCostLimitCents: 0,
      personalApiEnabled: true,
      redemptionDurationUnit: "DAYS",
      redemptionDurationValue: 45
    }),
    rewardType: "CODING_PLAN"
  });

  assert.deepEqual(points, { aiPointsBalanceCents: 1200, rewardType: "AI_POINTS" });
  assert.equal(plan?.rewardType, "CODING_PLAN");
  assert.equal(plan?.rewardType === "CODING_PLAN" ? plan.codingPlan.durationMonths : 0, 2);
  assert.equal(plan?.rewardType === "CODING_PLAN" ? plan.durationUnit : "", "DAYS");
  assert.equal(plan?.rewardType === "CODING_PLAN" ? plan.durationValue : 0, 45);
});
