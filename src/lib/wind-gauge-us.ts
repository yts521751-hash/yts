/**
 * 美股風度：S&P 500（^GSPC）／Nasdaq（^IXIC）。
 * 演算法沿用台股風度（乖離＋波動結構強度）。
 */

import {
  MA_STANCE_LABEL,
  WIND_META,
  type MaStance,
  type WindLevel,
  type WindReading,
} from "@/lib/wind-types";
import { US_WIND_CACHE, readUsCacheFile, writeUsCacheFile } from "@/lib/us-market";

export type UsWindPayload = {
  spx: WindReading;
  ndx: WindReading;
  builtAt: string;
  market: "us";
};

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

async function fetchYahooCloses(symbol: string): Promise<{
  closes: number[];
  asOf: string;
  changePct: number;
} | null> {
  const hosts = [
    "https://query1.finance.yahoo.com",
    "https://query2.finance.yahoo.com",
  ];
  for (const host of hosts) {
    try {
      const url = `${host}/v8/finance/chart/${encodeURIComponent(
        symbol,
      )}?interval=1d&range=6mo`;
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; JinMai-US/1.0; research)",
          Accept: "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) continue;
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
      const closes = raw.filter(
        (x): x is number => typeof x === "number" && x > 0,
      );
      if (closes.length < 40) continue;
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
      /* next */
    }
  }
  return null;
}

function sma(closes: number[], n: number): number | null {
  if (closes.length < n) return null;
  const slice = closes.slice(-n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

function bias(close: number, ma: number | null): number {
  if (ma == null || !(ma > 0)) return 0;
  return ((close - ma) / ma) * 100;
}

function vol20(closes: number[]): number {
  if (closes.length < 21) return 0;
  const rets: number[] = [];
  for (let i = closes.length - 20; i < closes.length; i++) {
    const a = closes[i - 1];
    const b = closes[i];
    if (a > 0 && b > 0) rets.push(((b - a) / a) * 100);
  }
  if (rets.length < 8) return 0;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  let sum = 0;
  for (const r of rets) sum += (r - mean) ** 2;
  return Math.sqrt(sum / rets.length);
}

function maStanceOf(
  close: number,
  ma5: number | null,
  ma20: number | null,
  ma60: number | null,
): MaStance {
  if (ma5 && ma20 && ma60 && ma5 > ma20 && ma20 > ma60 && close > ma5)
    return "bull-stack";
  if (ma5 && ma20 && ma60 && ma5 < ma20 && ma20 < ma60 && close < ma5)
    return "bear-stack";
  if (ma20 && ma60 && close > ma20 && close > ma60) {
    if (ma5 && close < ma5) return "above-ma20-ma60-below-ma5";
    return "above-ma20-ma60";
  }
  if (ma20 && close > ma20) return "above-ma20";
  if (ma60 && close > ma60 && ma20 && close < ma20) return "above-ma60-only";
  if (ma20 && ma60 && close < ma20 && close < ma60) {
    if (ma5 && close > ma5) return "below-ma20-ma60-above-ma5";
    return "below-ma20-ma60";
  }
  if (ma20 && close < ma20) return "below-ma20";
  return "tangled";
}

function scoreFromStructure(
  close: number,
  ma5: number | null,
  ma20: number | null,
  ma60: number | null,
  vol: number,
): { level: WindLevel; score: number } {
  let score = 20;
  if (ma5 && close > ma5) score += 18;
  else if (ma5 && close < ma5) score -= 8;
  if (ma20 && close > ma20) score += 22;
  else if (ma20 && close < ma20) score -= 10;
  if (ma60 && close > ma60) score += 16;
  else if (ma60 && close < ma60) score -= 8;
  if (ma5 && ma20 && ma60) {
    if (ma5 > ma20 && ma20 > ma60) score += 14;
    if (ma5 < ma20 && ma20 < ma60) score += 8;
  }
  if (vol > 1.8) score += 6;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const stance = maStanceOf(close, ma5, ma20, ma60);
  let level: WindLevel =
    score >= 62 ? "gale" : score >= 36 ? "gust" : "calm";
  if (
    stance === "tangled" &&
    vol > 1.4 &&
    score >= 30 &&
    score < 62
  ) {
    level = "turbulence";
  }
  if (score < 36 && stance === "tangled" && vol <= 1.2) level = "calm";
  return { level, score };
}

function readingFromCloses(
  label: string,
  market: WindReading["market"],
  series: { closes: number[]; asOf: string; changePct: number },
  source: string,
): WindReading {
  const closes = series.closes;
  const close = closes[closes.length - 1];
  const ma5 = sma(closes, 5);
  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);
  const vol = vol20(closes);
  const { level, score } = scoreFromStructure(close, ma5, ma20, ma60, vol);
  const stance = maStanceOf(close, ma5, ma20, ma60);
  return {
    market,
    label,
    level,
    levelLabel: WIND_META[level].label,
    score,
    close: Math.round(close * 100) / 100,
    changePct: Math.round(series.changePct * 100) / 100,
    bias5: Math.round(bias(close, ma5) * 100) / 100,
    bias20: Math.round(bias(close, ma20) * 100) / 100,
    bias60: Math.round(bias(close, ma60) * 100) / 100,
    vol20: Math.round(vol * 100) / 100,
    asOf: series.asOf,
    source,
    maStance: stance,
    maStanceLabel: MA_STANCE_LABEL[stance],
  };
}

function fallbackReading(
  label: string,
  market: WindReading["market"],
): WindReading {
  return {
    market,
    label,
    level: "calm",
    levelLabel: WIND_META.calm.label,
    score: 28,
    close: 0,
    changePct: 0,
    bias5: 0,
    bias20: 0,
    bias60: 0,
    vol20: 0,
    asOf: new Date().toISOString().slice(0, 10),
    source: "fallback",
    maStance: "tangled",
    maStanceLabel: MA_STANCE_LABEL.tangled,
  };
}

export async function buildUsWindGauge(options?: {
  force?: boolean;
}): Promise<UsWindPayload> {
  if (!options?.force) {
    const cached = await readUsCacheFile<UsWindPayload>(US_WIND_CACHE);
    if (cached?.spx && cached?.ndx) {
      const age = Date.now() - Date.parse(cached.builtAt || "");
      if (Number.isFinite(age) && age >= 0 && age < CACHE_TTL_MS) {
        return { ...cached, market: "us" };
      }
    }
  }

  const [spxSeries, ndxSeries] = await Promise.all([
    fetchYahooCloses("^GSPC"),
    fetchYahooCloses("^IXIC"),
  ]);

  const spx = spxSeries
    ? readingFromCloses("S&P 500", "spx", spxSeries, "yahoo-GSPC")
    : fallbackReading("S&P 500", "spx");
  const ndx = ndxSeries
    ? readingFromCloses("Nasdaq Composite", "ndx", ndxSeries, "yahoo-IXIC")
    : fallbackReading("Nasdaq Composite", "ndx");

  const payload: UsWindPayload = {
    spx,
    ndx,
    builtAt: new Date().toISOString(),
    market: "us",
  };
  await writeUsCacheFile(US_WIND_CACHE, payload);
  return payload;
}

export async function getUsWindGauge(options?: {
  force?: boolean;
}): Promise<UsWindPayload> {
  return buildUsWindGauge(options);
}

export function requestUsWindRebuild(reason: string) {
  void buildUsWindGauge({ force: true }).then((p) => {
    console.log(`[us-wind] rebuilt (${reason}) asOf=${p.spx.asOf}`);
  });
}
