export const DEFAULT_WEB_SEARCH_COST_CENTS = 1;
export const MAX_WEB_SEARCH_COST_CENTS = 10_000;

export function normalizeWebSearchCostCents(
  value: unknown,
  fallback = DEFAULT_WEB_SEARCH_COST_CENTS
) {
  const numeric = typeof value === "string" && value.trim() ? Number(value) : value;
  const fallbackNumeric = Number.isFinite(Number(fallback))
    ? Math.max(0, Math.min(MAX_WEB_SEARCH_COST_CENTS, Number(fallback)))
    : DEFAULT_WEB_SEARCH_COST_CENTS;

  if (typeof numeric !== "number" || !Number.isFinite(numeric)) {
    return fallbackNumeric;
  }

  return Math.round(
    Math.max(0, Math.min(MAX_WEB_SEARCH_COST_CENTS, numeric)) * 10_000
  ) / 10_000;
}

export function calculateWebSearchCostCents(callCount: unknown, costPerCallCents: unknown) {
  const count = Math.max(0, Math.round(Number(callCount) || 0));
  const costPerCall = normalizeWebSearchCostCents(costPerCallCents);

  return Math.round(count * costPerCall * 10_000) / 10_000;
}
