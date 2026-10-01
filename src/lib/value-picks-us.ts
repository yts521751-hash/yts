/**
 * 美股價值選股：Yahoo EPS 共識（forward／earningsTrend）。
 * 門檻改美元：明年 EPS YoY > 50%，前瞻 PE < 35，當日成交 ≥ 1 億美元。
 * 無台股月營收；季營收 YoY 若可得則附帶，不擋篩選。
 */

import {
  US_VALUE_CACHE,
  getUsCachedDayQuotes,
  isUsCommonStock,
  listUsCachedTradingDays,
  readUsCacheFile,
  writeUsCacheFile,
  ymdToIso,
} from "@/lib/us-market";

export type UsValuePickRow = {
  rank: number;
  code: string;
  name: string;
  close: number;
  changePct: number;
  dayAmt: number;
  nextYearEps: number;
  baseEps: number;
  epsYoy: number;
  forwardPe: number;
  epsSource: string | null;
  revenueYoy?: number | null;
};

export type UsValuePicksPayload = {
  date: string;
  ymd: string;
  rows: UsValuePickRow[];
  builtAt: string;
  source: "cache" | "rebuilt";
  scanned: number;
  criteria: {
    minEpsYoy: number;
    maxForwardPe: number;
    minDayAmtYi: number;
  };
  market: "us";
  note: string;
};

const MIN_EPS_YOY = 50;
const MAX_FORWARD_PE = 35;
/** 1 億美元 */
const MIN_DAY_AMT_YI = 1;
const YI = 1e8;
const CANDIDATE_LIMIT = 80;
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type YahooEps = {
  nextYearEps: number | null;
  baseEps: number | null;
  source: string | null;
  revenueYoy: number | null;
};

async function fetchYahooEps(symbol: string): Promise<YahooEps> {
  const empty: YahooEps = {
    nextYearEps: null,
    baseEps: null,
    source: null,
    revenueYoy: null,
  };
  try {
    const url =
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
      `?modules=earningsTrend,defaultKeyStatistics,incomeStatementHistoryQuarterly`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; JinMai-US/1.0)",
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return empty;
    const data = (await res.json()) as {
      quoteSummary?: {
        result?: Array<{
          earningsTrend?: {
            trend?: Array<{
              period?: string;
              earningsEstimate?: { avg?: { raw?: number } };
            }>;
          };
          defaultKeyStatistics?: {
            forwardEps?: { raw?: number };
            trailingEps?: { raw?: number };
          };
          incomeStatementHistoryQuarterly?: {
            incomeStatementHistory?: Array<{
              endDate?: { raw?: number };
              totalRevenue?: { raw?: number };
            }>;
          };
        }>;
      };
    };
    const r = data.quoteSummary?.result?.[0];
    if (!r) return empty;

    let nextYearEps: number | null = null;
    let baseEps: number | null = null;
    const trends = r.earningsTrend?.trend ?? [];
    const byPeriod = new Map(
      trends.map((t) => [String(t.period || ""), t.earningsEstimate?.avg?.raw]),
    );
    // Yahoo periods: 0y, +1y
    const y0 = byPeriod.get("0y");
    const y1 = byPeriod.get("+1y");
    if (typeof y1 === "number" && y1 > 0) nextYearEps = y1;
    if (typeof y0 === "number" && y0 > 0) baseEps = y0;

    if (nextYearEps == null) {
      const f = r.defaultKeyStatistics?.forwardEps?.raw;
      if (typeof f === "number" && f > 0) nextYearEps = f;
    }
    if (baseEps == null) {
      const t = r.defaultKeyStatistics?.trailingEps?.raw;
      if (typeof t === "number" && t > 0) baseEps = t;
    }

    let revenueYoy: number | null = null;
    const hist = r.incomeStatementHistoryQuarterly?.incomeStatementHistory ?? [];
    if (hist.length >= 5) {
      const latest = hist[0]?.totalRevenue?.raw;
      const yoy = hist[4]?.totalRevenue?.raw;
      if (
        typeof latest === "number" &&
        typeof yoy === "number" &&
        yoy > 0
      ) {
        revenueYoy = ((latest - yoy) / yoy) * 100;
      }
    }

    return {
      nextYearEps,
      baseEps,
      source:
        nextYearEps != null
          ? `yahoo-earningsTrend:${symbol}`
          : null,
      revenueYoy:
        revenueYoy != null ? Math.round(revenueYoy * 10) / 10 : null,
    };
  } catch {
    return empty;
  }
}

export async function buildUsValuePicks(options?: {
  force?: boolean;
}): Promise<UsValuePicksPayload | null> {
  if (!options?.force) {
    const cached = await readUsCacheFile<UsValuePicksPayload>(US_VALUE_CACHE);
    if (cached?.rows) return { ...cached, source: "cache", market: "us" };
  }

  const days = await listUsCachedTradingDays(1, 40);
  if (!days.length) return null;
  const quotes = await getUsCachedDayQuotes(days[0]);
  if (!quotes?.size) return null;

  const candidates = [...quotes.values()]
    .filter((q) => isUsCommonStock(q.code, q.name) && q.turnover >= MIN_DAY_AMT_YI * YI)
    .sort((a, b) => b.turnover - a.turnover)
    .slice(0, CANDIDATE_LIMIT);

  const picks: UsValuePickRow[] = [];
  for (const q of candidates) {
    const eps = await fetchYahooEps(q.code);
    await sleep(120);
    if (
      eps.nextYearEps == null ||
      eps.baseEps == null ||
      !(eps.baseEps > 0) ||
      !(eps.nextYearEps > 0)
    ) {
      continue;
    }
    const epsYoy = ((eps.nextYearEps - eps.baseEps) / Math.abs(eps.baseEps)) * 100;
    const forwardPe = q.close / eps.nextYearEps;
    if (epsYoy <= MIN_EPS_YOY || forwardPe >= MAX_FORWARD_PE || forwardPe <= 0) {
      continue;
    }
    picks.push({
      rank: 0,
      code: q.code,
      name: q.name || q.code,
      close: round2(q.close),
      changePct: round2(q.changePct),
      dayAmt: round1(q.turnover / YI),
      nextYearEps: round2(eps.nextYearEps),
      baseEps: round2(eps.baseEps),
      epsYoy: round1(epsYoy),
      forwardPe: round1(forwardPe),
      epsSource: eps.source,
      revenueYoy: eps.revenueYoy,
    });
  }

  picks.sort((a, b) => b.epsYoy - a.epsYoy);
  picks.forEach((p, i) => {
    p.rank = i + 1;
  });

  const payload: UsValuePicksPayload = {
    date: ymdToIso(days[0]),
    ymd: days[0],
    rows: picks,
    builtAt: new Date().toISOString(),
    source: "rebuilt",
    scanned: candidates.length,
    criteria: {
      minEpsYoy: MIN_EPS_YOY,
      maxForwardPe: MAX_FORWARD_PE,
      minDayAmtYi: MIN_DAY_AMT_YI,
    },
    market: "us",
    note: "無台股月營收；EPS 取 Yahoo earningsTrend／forwardEps；成交門檻 1 億美元",
  };
  await writeUsCacheFile(US_VALUE_CACHE, payload);
  return payload;
}

export async function getUsValuePicks(options?: {
  force?: boolean;
}): Promise<UsValuePicksPayload | null> {
  if (!options?.force) {
    const cached = await readUsCacheFile<UsValuePicksPayload>(US_VALUE_CACHE);
    if (cached?.rows) return { ...cached, source: "cache", market: "us" };
  }
  return buildUsValuePicks(options);
}
