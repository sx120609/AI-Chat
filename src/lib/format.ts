export function formatCents(cents: number) {
  const dollars = cents / 100;

  if (dollars > 0 && dollars < 1) {
    return `$${dollars.toFixed(6)}`;
  }

  return `$${dollars.toFixed(2)}`;
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}
