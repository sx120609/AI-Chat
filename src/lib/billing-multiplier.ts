export const DEFAULT_BILLING_MULTIPLIER = 1;
export const MAX_BILLING_MULTIPLIER = 100;

export type BillingMultiplierSchedule = {
  billingMultiplier?: number | null;
  billingMultiplierEndsAt?: Date | string | null;
  billingMultiplierStartsAt?: Date | string | null;
};

export function normalizeBillingMultiplier(value: unknown) {
  const parsed = typeof value === "string" ? Number(value) : value;

  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    return DEFAULT_BILLING_MULTIPLIER;
  }

  return Math.min(MAX_BILLING_MULTIPLIER, Math.max(0, Math.round(parsed * 10_000) / 10_000));
}

export function normalizeBillingScheduleDate(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const date = value instanceof Date ? value : new Date(String(value));

  if (Number.isNaN(date.getTime())) {
    throw new Error("倍率生效时间格式无效。");
  }

  return date;
}

export function validateBillingMultiplierSchedule(settings: BillingMultiplierSchedule) {
  const startsAt = normalizeBillingScheduleDate(settings.billingMultiplierStartsAt);
  const endsAt = normalizeBillingScheduleDate(settings.billingMultiplierEndsAt);

  if (startsAt && endsAt && endsAt <= startsAt) {
    throw new Error("倍率结束时间必须晚于开始时间。");
  }

  return {
    billingMultiplier: normalizeBillingMultiplier(settings.billingMultiplier),
    billingMultiplierStartsAt: startsAt,
    billingMultiplierEndsAt: endsAt
  };
}

export function activeBillingMultiplier(
  settings: BillingMultiplierSchedule | null | undefined,
  now = new Date()
) {
  if (!settings) {
    return DEFAULT_BILLING_MULTIPLIER;
  }

  const startsAt = settings.billingMultiplierStartsAt
    ? new Date(settings.billingMultiplierStartsAt)
    : null;
  const endsAt = settings.billingMultiplierEndsAt
    ? new Date(settings.billingMultiplierEndsAt)
    : null;

  if ((startsAt && startsAt > now) || (endsAt && endsAt <= now)) {
    return DEFAULT_BILLING_MULTIPLIER;
  }

  return normalizeBillingMultiplier(settings.billingMultiplier);
}

export function billedCostCents(actualCostCents: number, multiplier: number) {
  const actual = Math.max(0, Number(actualCostCents) || 0);
  return Math.max(0, Math.round(actual * normalizeBillingMultiplier(multiplier) * 1_000_000) / 1_000_000);
}
