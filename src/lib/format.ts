/** 金額格式：億元（成交金額為絕對值） */
export function formatYi(n: number, digits = 1): string {
  const abs = Math.abs(n);
  if (abs >= 100) return `${n.toFixed(0)} 億`;
  return `${n.toFixed(digits)} 億`;
}

export function formatYiSigned(n: number, digits = 1): string {
  const sign = n > 0 ? "+" : "";
  const abs = Math.abs(n);
  if (abs >= 100) return `${sign}${n.toFixed(0)} 億`;
  return `${sign}${n.toFixed(digits)} 億`;
}

export function formatPct(n: number, digits = 2): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

export function formatHeat(n: number): string {
  return `${n.toFixed(2)}×`;
}

export function signedClass(n: number): string {
  if (n > 0) return "text-[var(--mk-up)]";
  if (n < 0) return "text-[var(--mk-down)]";
  return "text-muted-foreground";
}
