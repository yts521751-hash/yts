/** 金額格式：億元 */
export function formatYi(n: number, digits = 1): string {
  const abs = Math.abs(n);
  const sign = n > 0 ? "+" : n < 0 ? "" : "";
  if (abs >= 100) return `${sign}${n.toFixed(0)} 億`;
  return `${sign}${n.toFixed(digits)} 億`;
}

export function formatPct(n: number, digits = 2): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

export function signedClass(n: number): string {
  if (n > 0) return "text-[var(--tide-up)]";
  if (n < 0) return "text-[var(--tide-down)]";
  return "text-muted-foreground";
}
