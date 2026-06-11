export function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}
