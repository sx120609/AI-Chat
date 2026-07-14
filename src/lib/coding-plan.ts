export const CODING_PLAN_PRODUCT_TYPE = "CODING_PLAN" as const;
export const AI_POINTS_PRODUCT_TYPE = "AI_POINTS" as const;

export type PaymentProductType =
  | typeof AI_POINTS_PRODUCT_TYPE
  | typeof CODING_PLAN_PRODUCT_TYPE;

export type CodingPlanConfig = {
  description: string;
  enabled: boolean;
  monthlyCostLimitCents: number;
  name: string;
  personalApiEnabled: boolean;
  priceCents: number;
};

export type CodingPlanOrderSnapshot = Pick<
  CodingPlanConfig,
  "description" | "monthlyCostLimitCents" | "name" | "personalApiEnabled"
>;

const DEFAULT_CODING_PLAN: CodingPlanConfig = {
  description: "面向编码任务的月度额度套餐",
  enabled: false,
  monthlyCostLimitCents: 1000,
  name: "Coding Plan",
  personalApiEnabled: true,
  priceCents: 1990
};

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

export function normalizeCodingPlanConfig(value: Partial<CodingPlanConfig>): CodingPlanConfig {
  return {
    description: boundedText(value.description, DEFAULT_CODING_PLAN.description, 240),
    enabled: Boolean(value.enabled),
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
    priceCents: boundedInt(value.priceCents, DEFAULT_CODING_PLAN.priceCents, 100, 1_000_000)
  };
}

export function codingPlanSnapshot(config: CodingPlanConfig): CodingPlanOrderSnapshot {
  return {
    description: config.description,
    monthlyCostLimitCents: config.monthlyCostLimitCents,
    name: config.name,
    personalApiEnabled: config.personalApiEnabled
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
      description: codingPlan.description as string | undefined,
      enabled: true,
      monthlyCostLimitCents: codingPlan.monthlyCostLimitCents as number | undefined,
      name: codingPlan.name as string | undefined,
      personalApiEnabled: codingPlan.personalApiEnabled as boolean | undefined,
      priceCents: 100
    });

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
    codingPlanMonthlyCostLimitCents: codingPlan?.monthlyCostLimitCents ?? null,
    codingPlanName: codingPlan?.name ?? null,
    productType: codingPlan ? CODING_PLAN_PRODUCT_TYPE : AI_POINTS_PRODUCT_TYPE
  };
}
