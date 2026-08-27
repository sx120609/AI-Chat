import type { Prisma } from "../../generated/prisma/client";
import type { CodingPlanOrderSnapshot } from "@/lib/coding-plan";
import { nextQuotaResetAt } from "@/lib/quota";

export type EntitlementGrant =
  | {
      aiPointsBalanceCents: number;
      rewardType: "AI_POINTS";
    }
  | {
      codingPlan: CodingPlanOrderSnapshot;
      rewardType: "CODING_PLAN";
    };

export async function grantEntitlement(
  tx: Prisma.TransactionClient,
  userId: string,
  grant: EntitlementGrant,
  grantedAt = new Date()
) {
  if (grant.rewardType === "AI_POINTS") {
    const aiPointsBalanceCents = Math.max(1, Math.round(grant.aiPointsBalanceCents));

    await tx.user.update({
      where: { id: userId },
      data: {
        userGroup: "VIP",
        aiPointsBalanceCents: {
          increment: aiPointsBalanceCents
        }
      }
    });

    return {
      aiPointsBalanceCents,
      codingPlanExpiresAt: null,
      rewardType: grant.rewardType
    } as const;
  }

  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      codingPlanExpiresAt: true
    }
  });
  const existingExpiry = user.codingPlanExpiresAt;
  const base = existingExpiry && existingExpiry > grantedAt ? existingExpiry : grantedAt;
  const expiresAt = nextQuotaResetAt(base, grant.codingPlan.durationMonths);
  const startsNewPlan = !existingExpiry || existingExpiry <= grantedAt;

  await tx.user.update({
    where: { id: userId },
    data: {
      userGroup: "VIP",
      codingPlanExpiresAt: expiresAt,
      codingPlanDailyCostLimitCents: grant.codingPlan.dailyCostLimitCents,
      codingPlanId: grant.codingPlan.id,
      codingPlanMonthlyCostLimitCents: grant.codingPlan.monthlyCostLimitCents,
      codingPlanName: grant.codingPlan.name,
      codingPlanPersonalApiEnabled: grant.codingPlan.personalApiEnabled,
      codingPlanWeeklyCostLimitCents: grant.codingPlan.weeklyCostLimitCents,
      ...(startsNewPlan
        ? {
            quotaNextResetAt: nextQuotaResetAt(grantedAt),
            quotaResetAt: grantedAt,
            quotaSystemMigratedAt: grantedAt
          }
        : {})
    }
  });

  return {
    aiPointsBalanceCents: 0,
    codingPlanExpiresAt: expiresAt,
    rewardType: grant.rewardType
  } as const;
}
