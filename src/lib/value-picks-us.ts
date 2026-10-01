/**
 * 美股價值選股：Yahoo EPS 共識（earningsTrend／forwardEps，需 crumb）。
 * 門檻（相對台股放寬）：明年 EPS YoY > 25%，前瞻 PE < 40，當日成交 ≥ 0.5 億美元。
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
import { getYahooCrumbAuth, yahooAuthedGet } from "@/lib/yahoo-crumb";
import { US_YI_USD, usdTurnoverToYi } from "@/lib/turnover-us";

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
  /** EPS 抓取成功數（有 next+base） */
  epsOk: number;
  criteria: {
    minEpsYoy: number;
    maxForwardPe: number;
    minDayAmtYi: number;
  };
  market: "us";
  note: string;
  /** 無列時給前端的說明 */
  emptyReason: string | null;
};

/** 相對台股 50% 放寬：美股成長共識覆蓋較碎 */
const MIN_EPS_YOY = 25;
const MAX_FORWARD_PE = 40;
/** 0.5 億美元＝5e7 USD，涵蓋流動中大型 */
const MIN_DAY_AMT_YI = 0.5;
const CANDIDATE_LIMIT = 120;
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type YahooEps = {
  nextYearEps: number | null;
  baseEps: number | null;
  source: string | null;
  revenueYoy: number | null;
};

async function fetchYahooEps(
  symbol: string,
  auth: Awaited<ReturnType<typeof getYahooCrumbAuth>>,
): Promise<YahooEps> {
  const empty: YahooEps = {
    nextYearEps: null,
    baseEps: null,
    source: null,
    revenueYoy: null,
  };
  if (!auth) return empty;
  try {
    const url =
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
      `?modules=earningsTrend,defaultKeyStatistics,incomeStatementHistoryQuarterly`;
    const raw = await yahooAuthedGet(url, auth);
    if (!raw) return empty;
    const data = JSON.parse(raw) as {
      quoteSummary?: {
        result?: Array<{
          earningsTrend?: {
            trend?: Array<{
              period?: string;
              earningsEstimate?: { avg?: { raw?: number } };
              growth?: { raw?: number };
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
      finance?: { error?: { description?: string } };
    };
    if (data.finance?.error) return empty;
    const r = data.quoteSummary?.result?.[0];
    if (!r) return empty;

    let nextYearEps: number | null = null;
    let baseEps: number | null = null;
    const trends = r.earningsTrend?.trend ?? [];
    const byPeriod = new Map(
      trends.map((t) => [String(t.period || ""), t]),
    );
    const y0 = byPeriod.get("0y");
    const y1 = byPeriod.get("+1y");
    const y1Avg = y1?.earningsEstimate?.avg?.raw;
    const y0Avg = y0?.earningsEstimate?.avg?.raw;
    if (typeof y1Avg === "number" && y1Avg > 0) nextYearEps = y1Avg;
    if (typeof y0Avg === "number" && y0Avg > 0) baseEps = y0Avg;

    if (nextYearEps == null) {
      const f = r.defaultKeyStatistics?.forwardEps?.raw;
      if (typeof f === "number" && f > 0) nextYearEps = f;
    }
    if (baseEps == null) {
      const t = r.defaultKeyStatistics?.trailingEps?.raw;
      if (typeof t === "number" && t > 0) baseEps = t;
    }

    // 若缺 base 但有 +1y growth，用 next/(1+g) 反推
    if (
      baseEps == null &&
      nextYearEps != null &&
      typeof y1?.growth?.raw === "number" &&
      y1.growth.raw > -0.9
    ) {
      const g = y1.growth.raw;
      const implied = nextYearEps / (1 + g);
      if (implied > 0) baseEps = implied;
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
        nextYearEps != null ? `yahoo-earningsTrend:${symbol}` : null,
      revenueYoy:
        revenueYoy != null ? Math.round(revenueYoy * 10) / 10 : null,
    };
  } catch {
    return empty;
  }
}

function emptyReasonText(args: {
  scanned: number;
  epsOk: number;
  picks: number;
  authOk: boolean;
  criteria: UsValuePicksPayload["criteria"];
}): string | null {
  if (args.picks > 0) return null;
  if (!args.authOk) {
    return "Yahoo EPS 授權失敗（crumb），無法取得前瞻盈餘；請稍後重算或檢查網路。";
  }
  if (args.scanned === 0) {
    return "尚無符合成交門檻的候選（請先同步美股報價）。";
  }
  if (args.epsOk === 0) {
    return `已掃描 ${args.scanned} 檔流動股，但 Yahoo 未回傳可用 EPS 共識；請稍後重算。`;
  }
  return (
    `已掃描 ${args.scanned} 檔（其中 ${args.epsOk} 檔有 EPS），` +
    `無標的通過門檻：EPS YoY > ${args.criteria.minEpsYoy}%、` +
    `前瞻 PE < ${args.criteria.maxForwardPe}、` +
    `成交 ≥ ${args.criteria.minDayAmtYi} 億美元。`
  );
}

export async function buildUsValuePicks(options?: {
  force?: boolean;
}): Promise<UsValuePicksPayload | null> {
  if (!options?.force) {
    const cached = await readUsCacheFile<UsValuePicksPayload>(US_VALUE_CACHE);
    // 空列不長期當命中：避免 crumb 失敗一次就永久空白
    if (cached?.rows?.length) {
      return { ...cached, source: "cache", market: "us" };
    }
  }

  const days = await listUsCachedTradingDays(1, 40);
  if (!days.length) return null;
  const quotes = await getUsCachedDayQuotes(days[0]);
  if (!quotes?.size) return null;

  const minTurnover = MIN_DAY_AMT_YI * US_YI_USD;
  const candidates = [...quotes.values()]
    .filter((q) => isUsCommonStock(q.code, q.name) && q.turnover >= minTurnover)
    .sort((a, b) => b.turnover - a.turnover)
    .slice(0, CANDIDATE_LIMIT);

  const auth = await getYahooCrumbAuth();
  const picks: UsValuePickRow[] = [];
  let epsOk = 0;

  for (const q of candidates) {
    const eps = await fetchYahooEps(q.code, auth);
    await sleep(100);
    if (
      eps.nextYearEps == null ||
      eps.baseEps == null ||
      !(eps.baseEps > 0) ||
      !(eps.nextYearEps > 0)
    ) {
      continue;
    }
    epsOk++;
    const epsYoy =
      ((eps.nextYearEps - eps.baseEps) / Math.abs(eps.baseEps)) * 100;
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
      dayAmt: round1(usdTurnoverToYi(q.turnover)),
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

  const criteria = {
    minEpsYoy: MIN_EPS_YOY,
    maxForwardPe: MAX_FORWARD_PE,
    minDayAmtYi: MIN_DAY_AMT_YI,
  };
  const emptyReason = emptyReasonText({
    scanned: candidates.length,
    epsOk,
    picks: picks.length,
    authOk: Boolean(auth),
    criteria,
  });

  const payload: UsValuePicksPayload = {
    date: ymdToIso(days[0]),
    ymd: days[0],
    rows: picks,
    builtAt: new Date().toISOString(),
    source: "rebuilt",
    scanned: candidates.length,
    epsOk,
    criteria,
    market: "us",
    note:
      "無台股月營收；EPS 取 Yahoo earningsTrend／forwardEps（crumb）；" +
      `門檻 EPS YoY>${MIN_EPS_YOY}%、前瞻PE<${MAX_FORWARD_PE}、成交≥${MIN_DAY_AMT_YI}億美元`,
    emptyReason,
  };
  await writeUsCacheFile(US_VALUE_CACHE, payload);
  return payload;
}

export async function getUsValuePicks(options?: {
  force?: boolean;
}): Promise<UsValuePicksPayload | null> {
  if (!options?.force) {
    const cached = await readUsCacheFile<UsValuePicksPayload>(US_VALUE_CACHE);
    if (cached?.rows?.length) {
      return { ...cached, source: "cache", market: "us" };
    }
  }
  return buildUsValuePicks(options);
}
