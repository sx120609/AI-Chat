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

export function formatShortDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "未知时间";
  }

  return date.toLocaleString("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit"
  });
}
