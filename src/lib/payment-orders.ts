import type { PaymentOrder } from "../../generated/prisma/client";
import { cacheDelete } from "@/lib/cache";
import { prisma } from "@/lib/prisma";
import { usageCacheKey } from "@/lib/quota";

export async function settlePaidPaymentOrder(
  order: PaymentOrder,
  options?: {
    paidAt?: Date | null;
    providerTradeNo?: string | null;
  }
) {
  if (order.status === "PAID") {
    return {
      balanceCents: order.balanceCents > 0 ? order.balanceCents : order.amountCents,
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

    await tx.user.update({
      where: { id: order.userId },
      data: {
        aiPointsBalanceCents: {
          increment: balanceCents
        }
      }
    });

    return true;
  });

  if (settled) {
    await cacheDelete([usageCacheKey(order.userId)]);
  }

  return {
    balanceCents,
    settled
  };
}
