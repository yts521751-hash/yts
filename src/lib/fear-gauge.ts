/**
 * VIX 類情緒指標（非當日漲跌）：
 * 1) 優先抓 CBOE VIX（Yahoo ^VIX）
 * 2) 輔以台股加權近約 20 日實現波動（年化）
 * 分數愈高愈偏恐慌。
 */

export type FearGauge = {
  label: string;
  score: number;
  vix: number | null;
  realizedVol: number | null;
  source: "vix" | "realized" | "blend" | "fallback";
};

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

/** 把波動指數（VIX 或實現波動）映射成 0–100 恐慌分 */
export function scoreFromVol(vol: number): number {
  // 常見 VIX 區間：12 極低、15–20 常態、25+ 偏恐慌、35+ 極度恐慌
  if (vol < 12) return 22;
  if (vol < 15) return 35;
  if (vol < 20) return 48;
  if (vol < 25) return 58;
  if (vol < 30) return 72;
  if (vol < 40) return 85;
  return 95;
}

export function labelFromScore(score: number): string {
  if (score >= 85) return "極度恐慌";
  if (score >= 72) return "恐慌";
  if (score >= 58) return "偏謹慎";
  if (score >= 48) return "中性";
  if (score >= 35) return "偏樂觀";
  return "低波動";
}

/** 由日報酬％序列估算年化實現波動（％） */
export function realizedVolFromReturns(changePcts: number[]): number | null {
  const xs = changePcts.filter((x) => Number.isFinite(x));
  if (xs.length < 8) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  let sumSq = 0;
  for (const x of xs) sumSq += (x - mean) ** 2;
  const stdDaily = Math.sqrt(sumSq / xs.length); // 單位：％
  const annual = stdDaily * Math.sqrt(252);
  if (!Number.isFinite(annual) || annual <= 0) return null;
  return Math.round(annual * 10) / 10;
}

export async function fetchCboeVix(): Promise<number | null> {
  try {
    const url =
      "https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=5d";
    const res = await fetch(url, {
      headers: {
        "User-Agent": "JinMai/1.0 (fear-gauge; research)",
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      chart?: {
        result?: Array<{
          meta?: { regularMarketPrice?: number };
          indicators?: { quote?: Array<{ close?: Array<number | null> }> };
        }>;
      };
    };
    const result = data.chart?.result?.[0];
    const metaPx = result?.meta?.regularMarketPrice;
    if (typeof metaPx === "number" && Number.isFinite(metaPx) && metaPx > 0) {
      return Math.round(metaPx * 100) / 100;
    }
    const closes = result?.indicators?.quote?.[0]?.close ?? [];
    for (let i = closes.length - 1; i >= 0; i--) {
      const c = closes[i];
      if (typeof c === "number" && Number.isFinite(c) && c > 0) {
        return Math.round(c * 100) / 100;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 綜合 VIX 與台股實現波動。
 * - 兩者皆有：0.55×VIX + 0.45×實現波動
 * - 僅其一：用該值
 * - 皆無：中性後備
 */
export async function computeFearGauge(
  indexChangePcts: number[],
): Promise<FearGauge> {
  const [vix, realizedVol] = await Promise.all([
    fetchCboeVix(),
    Promise.resolve(realizedVolFromReturns(indexChangePcts)),
  ]);

  if (vix != null && realizedVol != null) {
    const blended = 0.55 * vix + 0.45 * realizedVol;
    const score = clamp(scoreFromVol(blended), 0, 100);
    return {
      label: labelFromScore(score),
      score,
      vix,
      realizedVol,
      source: "blend",
    };
  }

  if (vix != null) {
    const score = clamp(scoreFromVol(vix), 0, 100);
    return {
      label: labelFromScore(score),
      score,
      vix,
      realizedVol: null,
      source: "vix",
    };
  }

  if (realizedVol != null) {
    const score = clamp(scoreFromVol(realizedVol), 0, 100);
    return {
      label: labelFromScore(score),
      score,
      vix: null,
      realizedVol,
      source: "realized",
    };
  }

  return {
    label: "中性",
    score: 48,
    vix: null,
    realizedVol: null,
    source: "fallback",
  };
}
