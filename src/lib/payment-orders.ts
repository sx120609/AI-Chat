import type { PaymentOrder } from "../../generated/prisma/client";
import { cacheDelete } from "@/lib/cache";
import {
  CODING_PLAN_PRODUCT_TYPE,
  parseCodingPlanOrderSnapshot,
  paymentProductType
} from "@/lib/coding-plan";
import { prisma } from "@/lib/prisma";
import { nextQuotaResetAt, usageCacheKey } from "@/lib/quota";

export async function settlePaidPaymentOrder(
  order: PaymentOrder,
  options?: {
    paidAt?: Date | null;
    providerTradeNo?: string | null;
  }
) {
  const codingPlan = parseCodingPlanOrderSnapshot(order.metadataJson);

  if (order.status === "PAID") {
    return {
      balanceCents: codingPlan ? 0 : order.balanceCents > 0 ? order.balanceCents : order.amountCents,
      productType: paymentProductType(order.metadataJson),
      settled: false
    };
  }

  const balanceCents = order.balanceCents > 0 ? order.balanceCents : order.amountCents;
  const paidAt = options?.paidAt ?? new Date();
  const providerTradeNo = options?.providerTradeNo || order.providerTradeNo || null;
  const settled = await prisma.$transaction(async (tx) => {
    const updated = await tx.paymentOrder.updateMany({
      where: {
        id: order.id,
        status: { not: "PAID" }
      },
      data: {
        paidAt,
        providerTradeNo,
        status: "PAID"
      }
    });

    if (updated.count === 0) {
      return false;
    }

    if (codingPlan) {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: order.userId },
        select: {
          codingPlanExpiresAt: true
        }
      });
      const existingExpiry = user.codingPlanExpiresAt;
      const base = existingExpiry && existingExpiry > paidAt ? existingExpiry : paidAt;
      const expiresAt = nextQuotaResetAt(base);
      const startsNewPlan = !existingExpiry || existingExpiry <= paidAt;

      await tx.user.update({
        where: { id: order.userId },
        data: {
          codingPlanExpiresAt: expiresAt,
          codingPlanId: codingPlan.id,
          codingPlanMonthlyCostLimitCents: codingPlan.monthlyCostLimitCents,
          codingPlanName: codingPlan.name,
          codingPlanPersonalApiEnabled: codingPlan.personalApiEnabled,
          ...(startsNewPlan
            ? {
                quotaNextResetAt: nextQuotaResetAt(paidAt),
                quotaResetAt: paidAt,
                quotaSystemMigratedAt: paidAt
              }
            : {})
        }
      });
    } else {
      await tx.user.update({
        where: { id: order.userId },
        data: {
          aiPointsBalanceCents: {
            increment: balanceCents
          }
        }
      });
    }

    return true;
  });

  if (settled) {
    await cacheDelete([usageCacheKey(order.userId)]);
  }

  return {
    balanceCents: codingPlan ? 0 : balanceCents,
    productType: codingPlan ? CODING_PLAN_PRODUCT_TYPE : paymentProductType(order.metadataJson),
    settled
  };
}
