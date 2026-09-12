import "server-only";
/**
 * 風度儀表板：用均線乖離與波動，判斷上市／上櫃「強風、陣風、亂流、無風」。
 */

import {
  fetchTpexQuotes,
  listRecentTradingDays,
  readCacheFile,
  writeCacheFile,
} from "@/lib/tw-market";
import {
  WIND_META,
  type WindLevel,
  type WindPayload,
  type WindReading,
} from "@/lib/wind-types";

export type { WindLevel, WindPayload, WindReading } from "@/lib/wind-types";
export { WIND_META } from "@/lib/wind-types";

const CACHE = "wind-gauge.json";

function sma(xs: number[], n: number): number | null {
  if (xs.length < n) return null;
  const slice = xs.slice(xs.length - n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}

function ymdDash(ymd: string) {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

function classify(input: {
  close: number;
  ma5: number;
  ma20: number;
  ma60: number;
  vol20: number;
}): { level: WindLevel; score: number } {
  const { close, ma5, ma20, ma60, vol20 } = input;
  const bias5 = ((close - ma5) / ma5) * 100;
  const bias20 = ((close - ma20) / ma20) * 100;
  const bull = close > ma5 && ma5 > ma20 && ma20 > ma60;
  const bear = close < ma5 && ma5 < ma20 && ma20 < ma60;
  const aligned = bull || bear;
  const absBias = Math.max(Math.abs(bias5), Math.abs(bias20));
  const annualVol = vol20 * Math.sqrt(252);

  if (annualVol >= 22 && !aligned) {
    return { level: "turbulence", score: Math.min(92, 60 + annualVol) };
  }
  if (absBias <= 1.2 && annualVol <= 12) {
    return { level: "calm", score: Math.max(8, 28 - absBias * 4) };
  }
  if (aligned && Math.abs(bias20) >= 1.5) {
    return {
      level: "gale",
      score: Math.min(96, 58 + Math.abs(bias20) * 4 + (annualVol > 18 ? 6 : 0)),
    };
  }
  return {
    level: "gust",
    score: Math.min(78, 40 + absBias * 3 + annualVol * 0.4),
  };
}

async function fetchYahooCloses(symbol: string): Promise<{
  closes: number[];
  asOf: string;
  changePct: number;
} | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol,
    )}?interval=1d&range=6mo`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "JinMai/1.0 (wind-gauge)",
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: { quote?: Array<{ close?: Array<number | null> }> };
        }>;
      };
    };
    const result = data.chart?.result?.[0];
    const raw = result?.indicators?.quote?.[0]?.close ?? [];
    const closes = raw.filter((x): x is number => typeof x === "number" && x > 0);
    if (closes.length < 60) return null;
    const last = closes[closes.length - 1];
    const prev = closes[closes.length - 2] ?? last;
    const ts = result?.timestamp?.[result.timestamp.length - 1];
    const asOf = ts
      ? new Date(ts * 1000).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    return {
      closes,
      asOf,
      changePct: prev > 0 ? ((last - prev) / prev) * 100 : 0,
    };
  } catch {
    return null;
  }
}

type TpexSeries = {
  points: { ymd: string; close: number; changePct: number }[];
  updatedAt: string;
};

const TPEX_SERIES = "wind-tpex-series.json";

async function buildTpexSyntheticCloses(): Promise<{
  closes: number[];
  asOf: string;
  changePct: number;
  source: string;
} | null> {
  // 維護上櫃合成指數序列：每次最多補最近幾個交易日，避免一次打爆 API
  const series =
    (await readCacheFile<TpexSeries>(TPEX_SERIES)) ?? {
      points: [],
      updatedAt: "",
    };
  const known = new Set(series.points.map((p) => p.ymd));
  const days = await listRecentTradingDays(8, 20);
  const missing = days.filter((d) => !known.has(d)).reverse();

  let level =
    series.points.length > 0
      ? series.points[series.points.length - 1].close
      : 100;

  for (const ymd of missing) {
    try {
      const bundle = await fetchTpexQuotes(ymd);
      const quotes = bundle?.quotes ?? [];
      if (!quotes.length) continue;
      let num = 0;
      let den = 0;
      for (const q of quotes) {
        if (!q.turnover || q.turnover <= 0) continue;
        if (!Number.isFinite(q.changePct)) continue;
        num += q.changePct * q.turnover;
        den += q.turnover;
      }
      if (den <= 0) continue;
      const chg = num / den;
      level *= 1 + chg / 100;
      series.points.push({ ymd, close: level, changePct: chg });
    } catch {
      /* skip day */
    }
  }

  series.points.sort((a, b) => a.ymd.localeCompare(b.ymd));
  // 去重保最新
  const byYmd = new Map<string, (typeof series.points)[0]>();
  for (const p of series.points) byYmd.set(p.ymd, p);
  series.points = [...byYmd.values()].sort((a, b) => a.ymd.localeCompare(b.ymd));
  if (series.points.length > 120) {
    series.points = series.points.slice(series.points.length - 120);
  }
  series.updatedAt = new Date().toISOString();
  await writeCacheFile(TPEX_SERIES, series);

  if (series.points.length < 20) return null;
  const last = series.points[series.points.length - 1];
  return {
    closes: series.points.map((p) => p.close),
    asOf: ymdDash(last.ymd),
    changePct: last.changePct,
    source: "tpex-turnover-weighted",
  };
}

function readingFromCloses(
  market: "twse" | "tpex",
  label: string,
  closes: number[],
  changePct: number,
  asOf: string,
  source: string,
): WindReading {
  const close = closes[closes.length - 1];
  const ma5 = sma(closes, 5) ?? close;
  const ma20 = sma(closes, 20) ?? close;
  const ma60 = sma(closes, Math.min(60, closes.length)) ?? close;
  const rets: number[] = [];
  for (let i = Math.max(1, closes.length - 20); i < closes.length; i++) {
    rets.push(((closes[i] - closes[i - 1]) / closes[i - 1]) * 100);
  }
  const vol20 = stdev(rets);
  const { level, score } = classify({ close, ma5, ma20, ma60, vol20 });
  const bias = (c: number, m: number) => ((c - m) / m) * 100;
  return {
    market,
    label,
    level,
    levelLabel: WIND_META[level].label,
    score: Math.round(score),
    close: Math.round(close * 100) / 100,
    changePct: Math.round(changePct * 100) / 100,
    bias5: Math.round(bias(close, ma5) * 100) / 100,
    bias20: Math.round(bias(close, ma20) * 100) / 100,
    bias60: Math.round(bias(close, ma60) * 100) / 100,
    vol20: Math.round(vol20 * 100) / 100,
    asOf,
    source,
  };
}

function fallbackReading(
  market: "twse" | "tpex",
  label: string,
  changePct: number,
): WindReading {
  const abs = Math.abs(changePct);
  let level: WindLevel = "calm";
  let score = 24;
  if (abs >= 1.8) {
    level = "turbulence";
    score = 70;
  } else if (abs >= 0.35) {
    level = "gust";
    score = abs >= 0.8 ? 52 : 40;
  }
  return {
    market,
    label,
    level,
    levelLabel: WIND_META[level].label,
    score,
    close: 0,
    changePct,
    bias5: changePct,
    bias20: changePct,
    bias60: 0,
    vol20: abs,
    asOf: new Date().toISOString().slice(0, 10),
    source: "fallback-day-change",
  };
}

export async function computeWindPayload(options?: {
  force?: boolean;
  twseDayChangePct?: number;
}): Promise<WindPayload> {
  if (!options?.force) {
    const cached = await readCacheFile<WindPayload>(CACHE);
    if (cached?.twse && cached?.tpex && cached.builtAt) {
      const age = Date.now() - Date.parse(cached.builtAt);
      if (Number.isFinite(age) && age < 1000 * 60 * 30) return cached;
    }
  }

  const twii = await fetchYahooCloses("^TWII");
  const twse = twii
    ? readingFromCloses(
        "twse",
        "上市（加權）",
        twii.closes,
        twii.changePct,
        twii.asOf,
        "yahoo-TWII",
      )
    : fallbackReading("twse", "上市（加權）", options?.twseDayChangePct ?? 0);

  let tpex: WindReading;
  try {
    const syn = await buildTpexSyntheticCloses();
    tpex = syn
      ? readingFromCloses(
          "tpex",
          "上櫃（櫃買合成）",
          syn.closes,
          syn.changePct,
          syn.asOf,
          syn.source,
        )
      : fallbackReading("tpex", "上櫃（櫃買合成）", 0);
  } catch {
    tpex = fallbackReading("tpex", "上櫃（櫃買合成）", 0);
  }

  const payload: WindPayload = {
    twse,
    tpex,
    builtAt: new Date().toISOString(),
  };
  await writeCacheFile(CACHE, payload);
  return payload;
}

export async function getWindPayload(): Promise<WindPayload> {
  return computeWindPayload();
}
