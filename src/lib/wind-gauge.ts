import "server-only";
/**
 * 風度儀表板：依「指數相對均線的結構」分級（強風／陣風／亂流／無風）。
 * 分數看排列清楚程度，不用乖離率大小當主力道。
 */

import {
  fetchJson,
  fetchJsonViaCurl,
  fetchTpexQuotes,
  getCachedDayQuotes,
  listCachedTradingDays,
  listRecentTradingDays,
  readCacheFile,
  writeCacheFile,
} from "@/lib/tw-market";
import {
  MA_STANCE_LABEL,
  WIND_META,
  type MaStance,
  type WindLevel,
  type WindPayload,
  type WindReading,
} from "@/lib/wind-types";

export type { MaStance, WindLevel, WindPayload, WindReading } from "@/lib/wind-types";
export { MA_STANCE_LABEL, WIND_META } from "@/lib/wind-types";

const CACHE = "wind-gauge-v4.json";

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

/**
 * 風力度：依指數與 MA5／月／季線的「細分位置」計分。
 * 站上月季線與跌破月季線不再給對稱分（避免兩邊都 60）。
 * 分數仍非單純多空標籤；右上角 maStance 才是結構文字。
 */
function classify(input: {
  close: number;
  ma5: number;
  ma20: number;
  ma60: number;
  vol20: number;
  sampleDays: number;
  /** 櫃買波動本來較大，亂流／無風門檻略提高 */
  market: "twse" | "tpex";
}): { level: WindLevel; score: number } {
  const { close, ma5, ma20, ma60, vol20, sampleDays, market } = input;
  const above5 = close > ma5;
  const above20 = close > ma20;
  const above60 = close > ma60;
  const bull = above5 && ma5 > ma20 && ma20 > ma60;
  const bear = !above5 && ma5 < ma20 && ma20 < ma60;

  const links = [
    Math.sign(close - ma5),
    Math.sign(ma5 - ma20),
    Math.sign(ma20 - ma60),
  ];
  const upLinks = links.filter((s) => s > 0).length;
  const downLinks = links.filter((s) => s < 0).length;
  const alignedLinks = Math.max(upLinks, downLinks);
  const conflicting = upLinks > 0 && downLinks > 0;

  // 細分階梯：站上權重大、跌破權重小 → 同樣「陣風」分數也會拉開
  let ladder = 0;
  ladder += above5 ? 10 : 2;
  ladder += above20 ? 16 : 3;
  ladder += above60 ? 18 : 4;
  ladder += upLinks * 6;
  ladder += downLinks * 2;
  // 站上月季但低於五日＝回測中的偏多結構
  if (above20 && above60 && !above5) ladder += 5;
  // 跌破月季但高於五日＝弱反彈
  if (!above20 && !above60 && above5) ladder += 1;
  if (bull) ladder += 10;
  if (bear) ladder += 2;

  const annualVol = vol20 * Math.sqrt(252);
  const shortHist = sampleDays < 45;
  const turbVol = market === "tpex" ? 42 : 32;
  const calmVol = market === "tpex" ? 22 : 18;
  const volNudge = annualVol > 24 ? 2 : annualVol < 14 ? -1 : 0;

  // 先算結構分數，再依分數分級（避免 47 與 21 都叫陣風）
  let score: number;
  if ((bull || bear) && !shortHist) {
    const cap = market === "tpex" ? 86 : 94;
    score = Math.min(cap, Math.round(48 + ladder * 0.45 + volNudge));
  } else {
    const gustCap = shortHist ? (market === "tpex" ? 54 : 60) : 72;
    score = Math.min(gustCap, Math.max(12, Math.round(8 + ladder * 0.7 + volNudge)));
  }

  // 亂流覆寫：波動高且均線方向打架
  if (annualVol >= turbVol && conflicting && alignedLinks <= 1 && !shortHist) {
    return {
      level: "turbulence",
      score: Math.min(market === "tpex" ? 78 : 88, Math.round(52 + annualVol * 0.4)),
    };
  }
  // 無風覆寫：結構糾結、波動低
  if (conflicting && alignedLinks <= 1 && annualVol <= calmVol) {
    return { level: "calm", score: Math.max(8, Math.round(18 + ladder * 0.15)) };
  }

  // 分數帶：強風 ≥62、陣風 36–61、其餘無風（弱結構／跌破後力道弱）
  let level: WindLevel;
  if (score >= 62 || ((bull || bear) && !shortHist && score >= 55)) {
    level = "gale";
  } else if (score >= 36) {
    level = "gust";
  } else {
    level = "calm";
  }
  return { level, score };
}


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
            "Mozilla/5.0 (compatible; JinMai/1.0; +https://jinliu-board.onrender.com)",
          Accept: "application/json,text/plain,*/*",
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
      // 櫃買指數有時資料點略少於加權，40 日已夠算 BIAS20／波動
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
      /* try next host */
    }
  }
  return null;
}

function parseTwseNum(raw: string): number | null {
  const n = Number(String(raw).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

/** 民國年日期 → YYYY-MM-DD */
function rocDateToIso(raw: string): string | null {
  const m = String(raw)
    .trim()
    .match(/^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const y = Number(m[1]) + 1911;
  const mo = m[2].padStart(2, "0");
  const d = m[3].padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

const TWSE_SERIES = "wind-twse-fmtqik.json";

/**
 * 證交所 FMTQIK：發行量加權股價指數日收盤（Yahoo 在雲端常被擋時的主備援）
 */
async function fetchTwseIndexCloses(options?: {
  force?: boolean;
}): Promise<{
  closes: number[];
  asOf: string;
  changePct: number;
  source: string;
} | null> {
  type Point = { date: string; close: number };
  type Series = { points: Point[]; updatedAt: string };
  if (!options?.force) {
    const cached = await readCacheFile<Series>(TWSE_SERIES);
    if (cached?.points && cached.points.length >= 40 && cached.updatedAt) {
      const age = Date.now() - Date.parse(cached.updatedAt);
      if (Number.isFinite(age) && age >= 0 && age < 6 * 60 * 60 * 1000) {
        const pts = cached.points;
        const last = pts[pts.length - 1];
        const prev = pts[pts.length - 2] ?? last;
        return {
          closes: pts.map((p) => p.close),
          asOf: last.date,
          changePct:
            prev.close > 0 ? ((last.close - prev.close) / prev.close) * 100 : 0,
          source: "twse-FMTQIK-cache",
        };
      }
    }
  }

  const points: Point[] = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const y = dt.getUTCFullYear();
    const m = dt.getUTCMonth() + 1;
    const date = `${y}${String(m).padStart(2, "0")}01`;
    const url = `https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?response=json&date=${date}`;
    try {
      const payload =
        (await fetchJsonViaCurl<{
          stat?: string;
          data?: string[][];
        }>(url)) ??
        (await fetchJson<{
          stat?: string;
          data?: string[][];
        }>(url));
      if (!payload || payload.stat !== "OK" || !payload.data?.length) continue;
      for (const row of payload.data) {
        const iso = rocDateToIso(String(row[0] ?? ""));
        const close = parseTwseNum(String(row[4] ?? ""));
        if (!iso || close == null || close <= 0) continue;
        points.push({ date: iso, close });
      }
    } catch {
      /* next month */
    }
  }

  const byDate = new Map<string, number>();
  for (const p of points) byDate.set(p.date, p.close);
  const ordered = [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, close]) => ({ date, close }));
  if (ordered.length < 40) return null;

  await writeCacheFile(TWSE_SERIES, {
    points: ordered,
    updatedAt: new Date().toISOString(),
  } satisfies Series);

  const last = ordered[ordered.length - 1];
  const prev = ordered[ordered.length - 2] ?? last;
  return {
    closes: ordered.map((p) => p.close),
    asOf: last.date,
    changePct:
      prev.close > 0 ? ((last.close - prev.close) / prev.close) * 100 : 0,
    source: "twse-FMTQIK",
  };
}

const TPEX_INDEX_SERIES = "wind-tpex-trading-index.json";

/**
 * 櫃買「日成交量值指數」官方收盤（雲端無本機合成快取時的備援；比 Yahoo ^TWOII 可靠）
 */
async function fetchTpexIndexCloses(options?: {
  force?: boolean;
}): Promise<{
  closes: number[];
  asOf: string;
  changePct: number;
  source: string;
} | null> {
  type Point = { date: string; close: number };
  type Series = { points: Point[]; updatedAt: string };
  if (!options?.force) {
    const cached = await readCacheFile<Series>(TPEX_INDEX_SERIES);
    if (cached?.points && cached.points.length >= 40 && cached.updatedAt) {
      const age = Date.now() - Date.parse(cached.updatedAt);
      if (Number.isFinite(age) && age >= 0 && age < 6 * 60 * 60 * 1000) {
        const pts = cached.points;
        const last = pts[pts.length - 1];
        const prev = pts[pts.length - 2] ?? last;
        return {
          closes: pts.map((p) => p.close),
          asOf: last.date,
          changePct:
            prev.close > 0 ? ((last.close - prev.close) / prev.close) * 100 : 0,
          source: "tpex-tradingIndex-cache",
        };
      }
    }
  }

  const points: Point[] = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const url =
      `https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingIndex` +
      `?date=${y}%2F${m}%2F01&id=&response=json`;
    try {
      const payload =
        (await fetchJsonViaCurl<{
          tables?: Array<{ data?: Array<Array<string | number>> }>;
        }>(url)) ??
        (await fetchJson<{
          tables?: Array<{ data?: Array<Array<string | number>> }>;
        }>(url));
      const rows = payload?.tables?.[0]?.data ?? [];
      for (const row of rows) {
        const iso = rocDateToIso(String(row[0] ?? ""));
        const close = parseTwseNum(String(row[4] ?? ""));
        if (!iso || close == null || close <= 0) continue;
        points.push({ date: iso, close });
      }
    } catch {
      /* next month */
    }
  }

  const byDate = new Map<string, number>();
  for (const p of points) byDate.set(p.date, p.close);
  const ordered = [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, close]) => ({ date, close }));
  if (ordered.length < 40) return null;

  await writeCacheFile(TPEX_INDEX_SERIES, {
    points: ordered,
    updatedAt: new Date().toISOString(),
  } satisfies Series);

  const last = ordered[ordered.length - 1];
  const prev = ordered[ordered.length - 2] ?? last;
  return {
    closes: ordered.map((p) => p.close),
    asOf: last.date,
    changePct:
      prev.close > 0 ? ((last.close - prev.close) / prev.close) * 100 : 0,
    source: "tpex-tradingIndex",
  };
}

type TpexSeries = {
  points: { ymd: string; close: number; changePct: number }[];
  updatedAt: string;
};

const TPEX_SERIES = "wind-tpex-series.json";

/** 櫃買常見指標股：用來從合併行情快取抽出上櫃權值近似 */
const OTC_MARKER_CODES = new Set([
  "3081",
  "4966",
  "4979",
  "5274",
  "6488",
  "3529",
  "8299",
  "6546",
  "3105",
  "3227",
  "3260",
  "3374",
  "3443",
  "3481",
  "3532",
  "3661",
  "3707",
  "4128",
  "4743",
  "5347",
  "5483",
  "6104",
  "6182",
  "6274",
  "6415",
  "6446",
  "6462",
  "6510",
  "6669",
  "8028",
]);

async function loadOtcCodeSet(): Promise<Set<string>> {
  const map = await readCacheFile<{
    stocks?: { code: string; market?: string }[];
  }>("industry-map.json");
  const set = new Set<string>();
  for (const s of map?.stocks ?? []) {
    if (s.market === "tpex" && /^\d{4}$/.test(s.code)) set.add(s.code);
  }
  if (set.size < 50) {
    for (const c of OTC_MARKER_CODES) set.add(c);
  }
  return set;
}

function weightedDayChange(
  quotes: { code: string; changePct: number; turnover: number }[],
  otcCodes: Set<string>,
): number | null {
  let num = 0;
  let den = 0;
  for (const q of quotes) {
    if (!otcCodes.has(q.code)) continue;
    if (!q.turnover || q.turnover <= 0) continue;
    if (!Number.isFinite(q.changePct)) continue;
    num += q.changePct * q.turnover;
    den += q.turnover;
  }
  if (den <= 0) return null;
  return num / den;
}

async function buildTpexSyntheticCloses(options?: {
  force?: boolean;
  /** 請求路徑預設 false：只吃本機快取，避免一次打 40+ 日櫃買卡住 API */
  allowNetwork?: boolean;
}): Promise<{
  closes: number[];
  asOf: string;
  changePct: number;
  source: string;
} | null> {
  // 維護上櫃合成指數：優先用本機合併行情快取回填，不足再打櫃買 API
  let series =
    (await readCacheFile<TpexSeries>(TPEX_SERIES)) ?? {
      points: [],
      updatedAt: "",
    };
  // 點數不足或強制更新時整段重算，避免殘留少數壞點永遠補不齊
  if (options?.force || series.points.length < 15) {
    series = { points: [], updatedAt: "" };
  }
  const known = new Set(series.points.map((p) => p.ymd));
  const otcCodes = await loadOtcCodeSet();

  const need = Math.max(100, 20 - series.points.length + 5);
  const cachedDays = await listCachedTradingDays(need, 180);
  // 由舊到新累乘，才不會把指數基準弄亂
  const missingCached = cachedDays
    .filter((d) => !known.has(d))
    .sort((a, b) => a.localeCompare(b));

  let level =
    series.points.length > 0
      ? series.points[series.points.length - 1].close
      : 100;

  // Pass 1：只吃本機已含櫃買的合併快取（不打網路）
  for (const ymd of missingCached) {
    const map = await getCachedDayQuotes(ymd);
    if (!map?.size) continue;
    const chg = weightedDayChange([...map.values()], otcCodes);
    if (chg == null) continue;
    level *= 1 + chg / 100;
    series.points.push({ ymd, close: level, changePct: chg });
    known.add(ymd);
  }

  // Pass 2：背景／強制暖機才補抓；請求熱路徑跳過，避免週末卡住風度頁
  const allowNetwork = options?.allowNetwork === true;
  if (allowNetwork && series.points.length < 50) {
    const days = await listRecentTradingDays(70, 140);
    const missing = days
      .filter((d) => !known.has(d))
      .sort((a, b) => a.localeCompare(b))
      .slice(-35);
    let fetched = 0;
    const OTC_FETCH_CAP = 28;
    for (const ymd of missing) {
      if (fetched >= OTC_FETCH_CAP) break;
      try {
        fetched += 1;
        const bundle = await fetchTpexQuotes(ymd);
        const quotes = bundle?.quotes ?? [];
        if (!quotes.length) continue;
        const chg = weightedDayChange(
          quotes.map((q) => ({
            code: q.code,
            changePct: q.changePct,
            turnover: q.turnover,
          })),
          new Set(quotes.map((q) => q.code)),
        );
        if (chg == null) continue;
        // 網路補點後若序列已亂序，稍後統一重算 level
        series.points.push({ ymd, close: 0, changePct: chg });
        known.add(ymd);
      } catch {
        /* skip day */
      }
    }
  }

  series.points.sort((a, b) => a.ymd.localeCompare(b.ymd));
  const byYmd = new Map<string, (typeof series.points)[0]>();
  for (const p of series.points) byYmd.set(p.ymd, p);
  series.points = [...byYmd.values()].sort((a, b) => a.ymd.localeCompare(b.ymd));

  // 用 changePct 重算指數水準，避免插入舊日後 close 基準錯亂
  level = 100;
  for (const p of series.points) {
    level *= 1 + p.changePct / 100;
    p.close = level;
  }

  if (series.points.length > 120) {
    series.points = series.points.slice(series.points.length - 120);
  }
  series.updatedAt = new Date().toISOString();
  await writeCacheFile(TPEX_SERIES, series);

  if (series.points.length < 15) return null;
  const last = series.points[series.points.length - 1];
  return {
    closes: series.points.map((p) => p.close),
    asOf: ymdDash(last.ymd),
    changePct: last.changePct,
    source: "tpex-turnover-weighted",
  };
}

function resolveMaStance(
  close: number,
  ma5: number,
  ma20: number,
  ma60: number,
): MaStance {
  const above5 = close > ma5;
  const above20 = close > ma20;
  const above60 = close > ma60;
  const bull = above5 && ma5 > ma20 && ma20 > ma60;
  const bear = !above5 && ma5 < ma20 && ma20 < ma60;
  if (bull) return "bull-stack";
  if (bear) return "bear-stack";
  if (above20 && above60 && !above5) return "above-ma20-ma60-below-ma5";
  if (above20 && above60) return "above-ma20-ma60";
  if (above20) return "above-ma20";
  if (above60 && !above20) return "above-ma60-only";
  if (!above20 && !above60 && above5) return "below-ma20-ma60-above-ma5";
  if (!above20 && !above60) return "below-ma20-ma60";
  if (!above20) return "below-ma20";
  return "tangled";
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
  const { level, score } = classify({
    close,
    ma5,
    ma20,
    ma60,
    vol20,
    sampleDays: closes.length,
    market,
  });
  const bias = (c: number, m: number) => ((c - m) / m) * 100;
  const maStance = resolveMaStance(close, ma5, ma20, ma60);
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
    maStance,
    maStanceLabel: MA_STANCE_LABEL[maStance],
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
    maStance: "tangled",
    maStanceLabel: MA_STANCE_LABEL.tangled,
  };
}

type WindGlobal = {
  rebuilding?: boolean;
};

function windBag(): WindGlobal {
  const g = globalThis as typeof globalThis & { __jinchaoWind?: WindGlobal };
  if (!g.__jinchaoWind) g.__jinchaoWind = {};
  return g.__jinchaoWind;
}

export async function computeWindPayload(options?: {
  force?: boolean;
  twseDayChangePct?: number;
  /** 允許櫃買歷史補抓網路；背景暖機用 */
  allowNetwork?: boolean;
}): Promise<WindPayload> {
  if (!options?.force) {
    const cached = await readCacheFile<WindPayload>(CACHE);
    if (cached?.twse && cached?.tpex && cached.builtAt) {
      const age = Date.now() - Date.parse(cached.builtAt);
      if (Number.isFinite(age) && age < 1000 * 60 * 30) {
        return {
          ...cached,
          twse: withMaStance(cached.twse),
          tpex: withMaStance(cached.tpex),
        };
      }
    }
  }

  // 上市加權：優先證交所 FMTQIK（Render 上 Yahoo 常被擋，會變成全日漲跌／BIAS=0）
  const twseOfficial = await fetchTwseIndexCloses({ force: options?.force });
  const twii = twseOfficial ? null : await fetchYahooCloses("^TWII");
  const twse = twseOfficial
    ? readingFromCloses(
        "twse",
        "上市（加權）",
        twseOfficial.closes,
        twseOfficial.changePct,
        twseOfficial.asOf,
        twseOfficial.source,
      )
    : twii
      ? readingFromCloses(
          "twse",
          "上市（加權）",
          twii.closes,
          twii.changePct,
          twii.asOf,
          "yahoo-TWII",
        )
      : fallbackReading(
          "twse",
          "上市（加權）",
          options?.twseDayChangePct ?? 0,
        );

  // 櫃買：官方 tradingIndex 優先（完整日 K、BIAS 才準）→ 本機合成 →（謹慎）Yahoo
  let tpex: WindReading;
  try {
    const official = await fetchTpexIndexCloses({ force: options?.force });
    if (official) {
      tpex = readingFromCloses(
        "tpex",
        "上櫃（櫃買加權）",
        official.closes,
        official.changePct,
        official.asOf,
        official.source,
      );
    } else {
      const syn = await buildTpexSyntheticCloses({
        force: options?.force,
        allowNetwork: options?.allowNetwork === true,
      });
      if (syn) {
        tpex = readingFromCloses(
          "tpex",
          "上櫃（櫃買加權）",
          syn.closes,
          syn.changePct,
          syn.asOf,
          syn.source,
        );
      } else {
        const twoii = await fetchYahooCloses("^TWOII");
        const yahooOk =
          twoii &&
          Math.abs(twoii.changePct) <= 5 &&
          twoii.closes.length >= 40;
        tpex = yahooOk
          ? readingFromCloses(
              "tpex",
              "上櫃（櫃買）",
              twoii.closes,
              twoii.changePct,
              twoii.asOf,
              "yahoo-TWOII",
            )
          : fallbackReading("tpex", "上櫃（櫃買加權）", 0);
      }
    }
  } catch {
    const official = await fetchTpexIndexCloses({ force: true }).catch(
      () => null,
    );
    tpex = official
      ? readingFromCloses(
          "tpex",
          "上櫃（櫃買加權）",
          official.closes,
          official.changePct,
          official.asOf,
          official.source,
        )
      : fallbackReading("tpex", "上櫃（櫃買加權）", 0);
  }

  const payload: WindPayload = {
    twse,
    tpex,
    builtAt: new Date().toISOString(),
  };
  await writeCacheFile(CACHE, payload);
  return payload;
}

/** 背景重建風度（含櫃買歷史補齊）；不阻塞 HTTP */
export function requestWindRebuild(reason: string) {
  const bag = windBag();
  if (bag.rebuilding) {
    return { started: false, alreadyRunning: true };
  }
  bag.rebuilding = true;
  console.log(`[wind] background rebuild (${reason})`);
  void (async () => {
    try {
      await computeWindPayload({ force: true, allowNetwork: true });
      console.log(`[wind] background rebuild ok (${reason})`);
    } catch (e) {
      console.error(`[wind] background rebuild failed (${reason})`, e);
    } finally {
      bag.rebuilding = false;
    }
  })();
  return { started: true, alreadyRunning: false };
}

function isBrokenReading(r: WindReading | undefined): boolean {
  if (!r) return true;
  return (
    (!r.close || r.close <= 0) &&
    String(r.source || "").includes("fallback")
  );
}

/** 舊快取沒有 maStance 時，用 BIAS 粗推一版，避免 UI 空白 */
function withMaStance(r: WindReading): WindReading {
  if (r.maStance && r.maStanceLabel) return r;
  let maStance: MaStance = "tangled";
  if (r.bias5 > 0.3 && r.bias20 > 0.3 && r.bias60 > 0.3) {
    maStance = "bull-stack";
  } else if (r.bias5 < -0.3 && r.bias20 < -0.3 && r.bias60 < -0.3) {
    maStance = "bear-stack";
  } else if (r.bias20 > 0 && r.bias60 > 0) {
    maStance = "above-ma20-ma60";
  } else if (r.bias20 > 0) {
    maStance = "above-ma20";
  } else if (r.bias20 < 0 && r.bias60 < 0) {
    maStance = "below-ma20-ma60";
  } else if (r.bias20 < 0) {
    maStance = "below-ma20";
  }
  return {
    ...r,
    maStance,
    maStanceLabel: MA_STANCE_LABEL[maStance],
  };
}

export async function getWindPayload(): Promise<WindPayload> {
  const cached = await readCacheFile<WindPayload>(CACHE);
  if (cached?.twse && cached?.tpex && cached.builtAt) {
    const broken =
      isBrokenReading(cached.twse) || isBrokenReading(cached.tpex);
    const age = Date.now() - Date.parse(cached.builtAt);
    const stale = !Number.isFinite(age) || age >= 1000 * 60 * 30;
    // 壞掉或過期：先回快取，重算丟背景，避免開頁卡住
    if (broken || stale) {
      requestWindRebuild(broken ? "repair-broken" : "stale-cache");
    }
    return {
      ...cached,
      twse: withMaStance(cached.twse),
      tpex: withMaStance(cached.tpex),
    };
  }
  // 無快取：背景補齊；前景限時快速算一版，逾時先回暫值
  requestWindRebuild("cold-fill");
  try {
    const quick = await Promise.race([
      computeWindPayload({ force: true, allowNetwork: false }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4500)),
    ]);
    if (quick) return quick;
  } catch {
    /* fall through */
  }
  return {
    twse: fallbackReading("twse", "上市（加權）", 0),
    tpex: fallbackReading("tpex", "上櫃（櫃買加權）", 0),
    builtAt: new Date().toISOString(),
  };
}
