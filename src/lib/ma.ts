/** 共用均線計算（產業 K 線圖、均線掃描共用） */

export function smaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function lastSma(values: number[], period: number): number | null {
  if (values.length < period || period <= 0) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

export function biasPct(close: number, ma: number | null): number | null {
  if (ma == null || ma === 0 || !Number.isFinite(close)) return null;
  return ((close - ma) / ma) * 100;
}
