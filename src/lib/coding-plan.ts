export const CODING_PLAN_PRODUCT_TYPE = "CODING_PLAN" as const;
export const AI_POINTS_PRODUCT_TYPE = "AI_POINTS" as const;

export type PaymentProductType =
  | typeof AI_POINTS_PRODUCT_TYPE
  | typeof CODING_PLAN_PRODUCT_TYPE;

export type CodingPlanConfig = {
  dailyCostLimitCents: number;
  description: string;
  enabled: boolean;
  id: string;
  monthlyCostLimitCents: number;
  name: string;
  personalApiEnabled: boolean;
  priceCents: number;
  weeklyCostLimitCents: number;
};

export type CodingPlanOrderSnapshot = Pick<
  CodingPlanConfig,
  | "dailyCostLimitCents"
  | "description"
  | "id"
  | "monthlyCostLimitCents"
  | "name"
  | "personalApiEnabled"
  | "weeklyCostLimitCents"
>;

export const MAX_CODING_PLANS = 12;

const DEFAULT_CODING_PLAN: CodingPlanConfig = {
  dailyCostLimitCents: 0,
  description: "面向编码任务的月度额度套餐",
  enabled: false,
  id: "coding-plan",
  monthlyCostLimitCents: 1000,
  name: "Coding Plan",
  personalApiEnabled: true,
  priceCents: 1990,
  weeklyCostLimitCents: 0
};

export function defaultCodingPlan(): CodingPlanConfig {
  return { ...DEFAULT_CODING_PLAN };
}

function boundedInt(value: unknown, fallback: number, min: number, max: number) {
  const numberValue = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numberValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(numberValue)));
}

function boundedText(value: unknown, fallback: string, maxLength: number) {
  const text = typeof value === "string" ? value.trim() : "";

  return text ? text.slice(0, maxLength) : fallback;
}

function normalizePlanId(value: unknown, fallback: string) {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";

  return /^[a-z0-9][a-z0-9_-]{0,39}$/.test(id) ? id : fallback;
}

export function normalizeCodingPlanConfig(
  value: Partial<CodingPlanConfig>,
  fallbackId = DEFAULT_CODING_PLAN.id
): CodingPlanConfig {
  return {
    dailyCostLimitCents: boundedInt(value.dailyCostLimitCents, 0, 0, 10_000_000),
    description: boundedText(value.description, DEFAULT_CODING_PLAN.description, 240),
    enabled: Boolean(value.enabled),
    id: normalizePlanId(value.id, fallbackId),
    monthlyCostLimitCents: boundedInt(
      value.monthlyCostLimitCents,
      DEFAULT_CODING_PLAN.monthlyCostLimitCents,
      1,
      10_000_000
    ),
    name: boundedText(value.name, DEFAULT_CODING_PLAN.name, 80),
    personalApiEnabled:
      typeof value.personalApiEnabled === "boolean"
        ? value.personalApiEnabled
        : DEFAULT_CODING_PLAN.personalApiEnabled,
    priceCents: boundedInt(value.priceCents, DEFAULT_CODING_PLAN.priceCents, 100, 1_000_000),
    weeklyCostLimitCents: boundedInt(value.weeklyCostLimitCents, 0, 0, 10_000_000)
  };
}

export function normalizeCodingPlans(value: unknown, fallback: CodingPlanConfig[] = [defaultCodingPlan()]) {
  if (!Array.isArray(value)) {
    return fallback.map((plan, index) =>
      normalizeCodingPlanConfig(plan, `coding-plan-${index + 1}`)
    );
  }

  const usedIds = new Set<string>();
  const plans: CodingPlanConfig[] = [];

  for (const [index, item] of value.slice(0, MAX_CODING_PLANS).entries()) {
    const candidate = item && typeof item === "object" ? (item as Partial<CodingPlanConfig>) : {};
    let fallbackId = `coding-plan-${index + 1}`;

    while (usedIds.has(fallbackId)) {
      fallbackId = `${fallbackId}-x`;
    }

    const normalized = normalizeCodingPlanConfig(candidate, fallbackId);

    if (usedIds.has(normalized.id)) {
      continue;
    }

    usedIds.add(normalized.id);
    plans.push(normalized);
  }

  return plans;
}

export function parseCodingPlans(
  value: string | null | undefined,
  fallback: CodingPlanConfig[] = [defaultCodingPlan()]
) {
  if (!value?.trim()) {
    return normalizeCodingPlans(fallback, fallback);
  }

  try {
    return normalizeCodingPlans(JSON.parse(value), fallback);
  } catch {
    return normalizeCodingPlans(fallback, fallback);
  }
}

export function codingPlanSnapshot(config: CodingPlanConfig): CodingPlanOrderSnapshot {
  return {
    dailyCostLimitCents: config.dailyCostLimitCents,
    description: config.description,
    id: config.id,
    monthlyCostLimitCents: config.monthlyCostLimitCents,
    name: config.name,
    personalApiEnabled: config.personalApiEnabled,
    weeklyCostLimitCents: config.weeklyCostLimitCents
  };
}

export function parseCodingPlanOrderSnapshot(metadataJson: string | null | undefined) {
  try {
    const metadata = JSON.parse(metadataJson || "{}") as Record<string, unknown>;

    if (metadata.productType !== CODING_PLAN_PRODUCT_TYPE || !metadata.codingPlan) {
      return null;
    }

    const codingPlan = metadata.codingPlan as Record<string, unknown>;
    const normalized = normalizeCodingPlanConfig({
      dailyCostLimitCents: codingPlan.dailyCostLimitCents as number | undefined,
      description: codingPlan.description as string | undefined,
      enabled: true,
      id: codingPlan.id as string | undefined,
      monthlyCostLimitCents: codingPlan.monthlyCostLimitCents as number | undefined,
      name: codingPlan.name as string | undefined,
      personalApiEnabled: codingPlan.personalApiEnabled as boolean | undefined,
      priceCents: 100,
      weeklyCostLimitCents: codingPlan.weeklyCostLimitCents as number | undefined
    }, "legacy-coding-plan");

    return codingPlanSnapshot(normalized);
  } catch {
    return null;
  }
}

export function paymentProductType(metadataJson: string | null | undefined): PaymentProductType {
  return parseCodingPlanOrderSnapshot(metadataJson)
    ? CODING_PLAN_PRODUCT_TYPE
    : AI_POINTS_PRODUCT_TYPE;
}

export function serializePaymentProduct(metadataJson: string | null | undefined) {
  const codingPlan = parseCodingPlanOrderSnapshot(metadataJson);

  return {
    codingPlanDailyCostLimitCents: codingPlan?.dailyCostLimitCents ?? null,
    codingPlanMonthlyCostLimitCents: codingPlan?.monthlyCostLimitCents ?? null,
    codingPlanName: codingPlan?.name ?? null,
    codingPlanWeeklyCostLimitCents: codingPlan?.weeklyCostLimitCents ?? null,
    productType: codingPlan ? CODING_PLAN_PRODUCT_TYPE : AI_POINTS_PRODUCT_TYPE
  };
}
