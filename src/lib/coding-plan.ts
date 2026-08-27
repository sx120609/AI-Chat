export const CODING_PLAN_PRODUCT_TYPE = "CODING_PLAN" as const;
export const AI_POINTS_PRODUCT_TYPE = "AI_POINTS" as const;

export type PaymentProductType =
  | typeof AI_POINTS_PRODUCT_TYPE
  | typeof CODING_PLAN_PRODUCT_TYPE;

export type CodingPlanConfig = {
  dailyCostLimitCents: number;
  description: string;
  durationMonths: number;
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
  | "durationMonths"
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
  durationMonths: 1,
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
    durationMonths: boundedInt(value.durationMonths, 1, 1, 36),
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

export function validateCodingPlans(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error("Coding Plan 配置必须是数组。");
  }

  if (value.length > MAX_CODING_PLANS) {
    throw new Error(`Coding Plan 最多配置 ${MAX_CODING_PLANS} 个。`);
  }

  const usedIds = new Set<string>();

  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object") {
      throw new Error(`第 ${index + 1} 个 Coding Plan 配置无效。`);
    }

    const plan = item as Partial<CodingPlanConfig>;
    const id = typeof plan.id === "string" ? plan.id.trim().toLowerCase() : "";

    if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(id)) {
      throw new Error(`第 ${index + 1} 个 Coding Plan 的 ID 无效；请使用 1-40 位小写字母、数字、下划线或短横线。`);
    }

    if (usedIds.has(id)) {
      throw new Error(`Coding Plan ID “${id}” 重复。`);
    }

    usedIds.add(id);

    const durationMonths = Number(plan.durationMonths);
    const priceCents = Number(plan.priceCents);
    const monthlyCostLimitCents = Number(plan.monthlyCostLimitCents);
    const dailyCostLimitCents = Number(plan.dailyCostLimitCents ?? 0);
    const weeklyCostLimitCents = Number(plan.weeklyCostLimitCents ?? 0);

    if (!Number.isInteger(durationMonths) || durationMonths < 1 || durationMonths > 36) {
      throw new Error(`第 ${index + 1} 个 Coding Plan 的有效期必须是 1-36 个整月。`);
    }

    if (!Number.isInteger(priceCents) || priceCents < 100 || priceCents > 1_000_000) {
      throw new Error(`第 ${index + 1} 个 Coding Plan 的售价必须在 1.00-10000.00 元之间。`);
    }

    if (
      !Number.isInteger(monthlyCostLimitCents) ||
      monthlyCostLimitCents < 1 ||
      monthlyCostLimitCents > 10_000_000
    ) {
      throw new Error(`第 ${index + 1} 个 Coding Plan 的月额度无效。`);
    }

    if (
      !Number.isInteger(dailyCostLimitCents) ||
      dailyCostLimitCents < 0 ||
      dailyCostLimitCents > 10_000_000 ||
      !Number.isInteger(weeklyCostLimitCents) ||
      weeklyCostLimitCents < 0 ||
      weeklyCostLimitCents > 10_000_000
    ) {
      throw new Error(`第 ${index + 1} 个 Coding Plan 的日/周限额无效。`);
    }

    if (dailyCostLimitCents > monthlyCostLimitCents) {
      throw new Error(`第 ${index + 1} 个 Coding Plan 的每日限额不能高于每月额度。`);
    }

    if (weeklyCostLimitCents > monthlyCostLimitCents) {
      throw new Error(`第 ${index + 1} 个 Coding Plan 的每周限额不能高于每月额度。`);
    }

    if (dailyCostLimitCents > 0 && weeklyCostLimitCents > 0 && dailyCostLimitCents > weeklyCostLimitCents) {
      throw new Error(`第 ${index + 1} 个 Coding Plan 的每日限额不能高于每周限额。`);
    }
  }

  return normalizeCodingPlans(value, []);
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
    durationMonths: config.durationMonths,
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
      durationMonths: codingPlan.durationMonths as number | undefined,
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
    codingPlanDurationMonths: codingPlan?.durationMonths ?? null,
    codingPlanMonthlyCostLimitCents: codingPlan?.monthlyCostLimitCents ?? null,
    codingPlanName: codingPlan?.name ?? null,
    codingPlanWeeklyCostLimitCents: codingPlan?.weeklyCostLimitCents ?? null,
    productType: codingPlan ? CODING_PLAN_PRODUCT_TYPE : AI_POINTS_PRODUCT_TYPE
  };
}
