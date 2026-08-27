import type { PaymentOrder } from "../../generated/prisma/client";
import { cacheDelete } from "@/lib/cache";
import {
  CODING_PLAN_PRODUCT_TYPE,
  parseCodingPlanOrderSnapshot,
  paymentProductType
} from "@/lib/coding-plan";
import { grantEntitlement } from "@/lib/entitlements";
import { prisma } from "@/lib/prisma";
import { usageCacheKey } from "@/lib/quota";

export async function settlePaidPaymentOrder(
  order: PaymentOrder,
  options?: {
    paidAt?: Date | null;
    providerTradeNo?: string | null;
  }
) {
  const codingPlan = parseCodingPlanOrderSnapshot(order.metadataJson);

  if (order.status === "PAID") {
    await prisma.user.updateMany({
      where: {
        id: order.userId,
        userGroup: { not: "VIP" }
      },
      data: {
        userGroup: "VIP"
      }
    });

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

    await grantEntitlement(
      tx,
      order.userId,
      codingPlan
        ? { codingPlan, rewardType: CODING_PLAN_PRODUCT_TYPE }
        : { aiPointsBalanceCents: balanceCents, rewardType: "AI_POINTS" },
      paidAt
    );

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
