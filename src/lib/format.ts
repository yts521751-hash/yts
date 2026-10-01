/** 金額格式：億元（成交金額為絕對值） */
export function formatYi(n: number, digits = 1): string {
  const abs = Math.abs(n);
  if (abs >= 100) return `${n.toFixed(0)} 億`;
  return `${n.toFixed(digits)} 億`;
}

/**
 * 個股／成交排行用：固定一位小數，避免 ≥100 億被 formatYi 四捨五入成整數
 * （與成值頁顯示口徑一致，例如 396.8 不被顯示成 397）。
 */
export function formatTurnoverYi(n: number): string {
  return `${n.toFixed(1)} 億`;
}

/** 美股成交金額：單位億美元（1 億美元 = 1e8 USD） */
export function formatUsTurnoverYi(n: number): string {
  return `${n.toFixed(1)} 億美元`;
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
