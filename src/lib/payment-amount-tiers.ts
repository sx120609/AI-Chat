export type PaymentAmountTier = {
  amountCents: number;
  balanceCents: number;
};

export const DEFAULT_PAYMENT_AMOUNT_CENTS = [100, 500, 1000, 2000, 5000] as const;

function normalizePositiveCents(value: unknown) {
  const amount = typeof value === "number" ? value : Number(value);

  return Number.isFinite(amount) ? Math.max(1, Math.round(amount)) : null;
}

export function calculateBasePaymentBalanceCents(
  paymentAmountCents: number,
  balanceCentsPerYuan: number
) {
  const amountCents = Math.max(1, Math.round(paymentAmountCents));
  const rate = Math.max(1, Math.round(balanceCentsPerYuan));

  return Math.max(1, Math.round((amountCents * rate) / 100));
}

export function normalizePaymentAmountTiers(
  value: unknown,
  balanceCentsPerYuan: number
): PaymentAmountTier[] {
  const rawTiers = Array.isArray(value) ? value : [];
  const byAmount = new Map<number, PaymentAmountTier>();

  for (const item of rawTiers) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as Record<string, unknown>;
    const amountCents = normalizePositiveCents(record.amountCents);
    const balanceCents = normalizePositiveCents(record.balanceCents);

    if (!amountCents || !balanceCents) {
      continue;
    }

    byAmount.set(amountCents, { amountCents, balanceCents });
  }

  const tiers = Array.from(byAmount.values()).sort(
    (left, right) => left.amountCents - right.amountCents
  );

  if (tiers.length > 0) {
    return tiers;
  }

  return DEFAULT_PAYMENT_AMOUNT_CENTS.map((amountCents) => ({
    amountCents,
    balanceCents: calculateBasePaymentBalanceCents(amountCents, balanceCentsPerYuan)
  }));
}

export function parsePaymentAmountTiers(
  value: string | null | undefined,
  balanceCentsPerYuan: number
) {
  try {
    return normalizePaymentAmountTiers(JSON.parse(value || "[]"), balanceCentsPerYuan);
  } catch {
    return normalizePaymentAmountTiers([], balanceCentsPerYuan);
  }
}

export function calculateTieredPaymentBalanceCents(
  paymentAmountCents: number,
  balanceCentsPerYuan: number,
  tiers: PaymentAmountTier[]
) {
  const amountCents = Math.max(1, Math.round(paymentAmountCents));
  const normalizedTiers = normalizePaymentAmountTiers(tiers, balanceCentsPerYuan);
  const baseBalanceCents = calculateBasePaymentBalanceCents(amountCents, balanceCentsPerYuan);
  const exactTier = normalizedTiers.find((tier) => tier.amountCents === amountCents);

  if (exactTier) {
    return Math.max(baseBalanceCents, exactTier.balanceCents);
  }

  const lowerTiers = normalizedTiers.filter((tier) => tier.amountCents < amountCents);
  const upperTier = normalizedTiers.find((tier) => tier.amountCents > amountCents);
  const lowerTier = lowerTiers.at(-1);

  if (!lowerTier) {
    return baseBalanceCents;
  }

  const lowerRateBalanceCents = Math.round(
    amountCents * (lowerTier.balanceCents / lowerTier.amountCents)
  );

  if (!upperTier) {
    return Math.max(baseBalanceCents, lowerRateBalanceCents);
  }

  const progress =
    (amountCents - lowerTier.amountCents) / (upperTier.amountCents - lowerTier.amountCents);
  const lowerRate = lowerTier.balanceCents / lowerTier.amountCents;
  const upperRate = upperTier.balanceCents / upperTier.amountCents;
  const interpolatedRate = lowerRate + (upperRate - lowerRate) * progress;
  const interpolatedBalanceCents = Math.round(amountCents * interpolatedRate);

  return Math.max(baseBalanceCents, lowerRateBalanceCents, interpolatedBalanceCents);
}
