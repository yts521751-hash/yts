/**
 * 美股價值選股：前瞻 EPS 共識。
 * 優先 Nasdaq yearly earnings-forecast（免 crumb）；失敗再 Yahoo earningsTrend／forwardEps（crumb）。
 * 門檻：明年 EPS YoY > 25%，前瞻 PE < 40，當日成交 ≥ 0.5 億美元。
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
import { fetchNasdaqYearlyEps } from "@/lib/nasdaq-us";
import { US_YI_USD, usdTurnoverToYi } from "@/lib/turnover-us";
import { resolveUsDisplayNames, US_NAME_ZH } from "@/lib/us-company-names";

export type UsValuePickRow = {
  rank: number;
  code: string;
  name: string;
  nameEn?: string;
  nameZh?: string;
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

const MIN_EPS_YOY = 25;
const MAX_FORWARD_PE = 40;
const MIN_DAY_AMT_YI = 0.5;
const CANDIDATE_LIMIT = 120;
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type EpsHit = {
  nextYearEps: number;
  baseEps: number;
  source: string;
  revenueYoy: number | null;
};

async function fetchYahooEps(
  symbol: string,
  auth: Awaited<ReturnType<typeof getYahooCrumbAuth>>,
): Promise<Omit<EpsHit, "nextYearEps" | "baseEps"> & {
  nextYearEps: number | null;
  baseEps: number | null;
}> {
  const empty = {
    nextYearEps: null as number | null,
    baseEps: null as number | null,
    source: "",
    revenueYoy: null as number | null,
  };
  if (!auth) return empty;
  try {
    const hosts = [
      "https://query2.finance.yahoo.com",
      "https://query1.finance.yahoo.com",
    ];
    for (const host of hosts) {
      const url =
        `${host}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
        `?modules=earningsTrend,defaultKeyStatistics,incomeStatementHistoryQuarterly`;
      const raw = await yahooAuthedGet(url, auth);
      if (!raw) continue;
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
                totalRevenue?: { raw?: number };
              }>;
            };
          }>;
        };
        finance?: { error?: { description?: string } };
      };
      if (data.finance?.error) continue;
      const r = data.quoteSummary?.result?.[0];
      if (!r) continue;

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

      if (
        baseEps == null &&
        nextYearEps != null &&
        typeof y1?.growth?.raw === "number" &&
        y1.growth.raw > -0.9
      ) {
        const implied = nextYearEps / (1 + y1.growth.raw);
        if (implied > 0) baseEps = implied;
      }

      let revenueYoy: number | null = null;
      const hist =
        r.incomeStatementHistoryQuarterly?.incomeStatementHistory ?? [];
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

      if (nextYearEps != null || baseEps != null) {
        return {
          nextYearEps,
          baseEps,
          source: `yahoo-earningsTrend:${symbol}`,
          revenueYoy:
            revenueYoy != null ? Math.round(revenueYoy * 10) / 10 : null,
        };
      }
    }
    return empty;
  } catch {
    return empty;
  }
}

async function fetchUsForwardEps(
  symbol: string,
  auth: Awaited<ReturnType<typeof getYahooCrumbAuth>>,
): Promise<EpsHit | null> {
  // 1) Nasdaq yearly（免 crumb，雲端較穩）
  const nq = await fetchNasdaqYearlyEps(symbol);
  if (nq) {
    return {
      nextYearEps: nq.nextYearEps,
      baseEps: nq.baseEps,
      source: nq.source,
      revenueYoy: null,
    };
  }
  // 2) Yahoo quoteSummary（需 crumb）
  const y = await fetchYahooEps(symbol, auth);
  if (
    y.nextYearEps != null &&
    y.baseEps != null &&
    y.nextYearEps > 0 &&
    y.baseEps > 0
  ) {
    return {
      nextYearEps: y.nextYearEps,
      baseEps: y.baseEps,
      source: y.source || `yahoo:${symbol}`,
      revenueYoy: y.revenueYoy,
    };
  }
  return null;
}

function emptyReasonText(args: {
  scanned: number;
  epsOk: number;
  picks: number;
  epsProviderOk: boolean;
  criteria: UsValuePicksPayload["criteria"];
}): string | null {
  if (args.picks > 0) return null;
  if (args.scanned === 0) {
    return "尚無符合成交門檻的候選（請先同步美股報價）。";
  }
  if (args.epsOk === 0 && !args.epsProviderOk) {
    return "無法取得前瞻盈餘共識（Nasdaq／Yahoo 皆無可用 EPS）；請稍後重算或檢查網路。";
  }
  if (args.epsOk === 0) {
    return `已掃描 ${args.scanned} 檔流動股，但未回傳可用 EPS 共識；請稍後重算。`;
  }
  return (
    `已掃描 ${args.scanned} 檔（其中 ${args.epsOk} 檔有 EPS），` +
    `無標的通過門檻：EPS YoY > ${args.criteria.minEpsYoy}%、` +
    `前瞻 PE < ${args.criteria.maxForwardPe}、` +
    `成交 ≥ ${args.criteria.minDayAmtYi} 億美元。`
  );
}

function isBadEmptyCache(cached: UsValuePicksPayload | null): boolean {
  if (!cached) return true;
  if (cached.rows?.length) return false;
  // 舊版 crumb 失敗文案／空列：不當作命中，強制重算
  const reason = cached.emptyReason || "";
  if (/crumb|授權失敗/i.test(reason)) return true;
  if (!cached.rows?.length) return true;
  return false;
}

export async function buildUsValuePicks(options?: {
  force?: boolean;
}): Promise<UsValuePicksPayload | null> {
  if (!options?.force) {
    const cached = await readUsCacheFile<UsValuePicksPayload>(US_VALUE_CACHE);
    if (cached?.rows?.length && !isBadEmptyCache(cached)) {
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

  // Yahoo crumb 僅作後備；失敗不阻斷（Nasdaq 優先）
  const auth = await getYahooCrumbAuth();
  const picks: UsValuePickRow[] = [];
  let epsOk = 0;
  let epsProviderOk = false;

  for (const q of candidates) {
    const eps = await fetchUsForwardEps(q.code, auth);
    await sleep(80);
    if (!eps) continue;
    epsProviderOk = true;
    if (!(eps.baseEps > 0) || !(eps.nextYearEps > 0)) continue;
    epsOk++;
    const epsYoy =
      ((eps.nextYearEps - eps.baseEps) / Math.abs(eps.baseEps)) * 100;
    const forwardPe = q.close / eps.nextYearEps;
    if (epsYoy <= MIN_EPS_YOY || forwardPe >= MAX_FORWARD_PE || forwardPe <= 0) {
      continue;
    }
    const names = resolveUsDisplayNames({
      code: q.code,
      yahooName: q.name,
    });
    picks.push({
      rank: 0,
      code: q.code,
      name: names.name,
      nameEn: names.nameEn,
      nameZh: names.nameZh,
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
    epsProviderOk: epsProviderOk || Boolean(auth),
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
      "無台股月營收；EPS 優先 Nasdaq yearly forecast，其次 Yahoo earningsTrend／forwardEps；" +
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
    // 空列／舊 crumb 錯誤快取：走重建
  }
  return buildUsValuePicks(options);
}

export async function readUsValuePicksCache(): Promise<UsValuePicksPayload | null> {
  return readUsCacheFile<UsValuePicksPayload>(US_VALUE_CACHE);
}

/** 與台股 ValuePicksClient 相容的單股查詢結果 */
export type UsStockValueLookup = {
  code: string;
  name: string;
  nameEn?: string;
  nameZh?: string;
  close: number;
  changePct: number;
  dayAmt: number;
  nextYearEps: number | null;
  baseEps: number | null;
  epsYoy: number | null;
  forwardPe: number | null;
  epsSource: string | null;
  revenueYoy: number | null;
  revenueMonth: string | null;
  brokers: [];
  consensusBasis: null;
  passesScreen: boolean;
  ymd: string;
  date: string;
};

const LOOKUP_MEMO_TTL_MS = 5 * 60 * 1000;

function usLookupMemoBag() {
  const g = globalThis as typeof globalThis & {
    __jinliuUsValueLookupMemo?: Map<
      string,
      { at: number; value: UsStockValueLookup | null }
    >;
  };
  if (!g.__jinliuUsValueLookupMemo) g.__jinliuUsValueLookupMemo = new Map();
  return g.__jinliuUsValueLookupMemo;
}

function normalizeUsLookupKey(query: string) {
  return query.trim().toLowerCase();
}

function isUsTickerToken(q: string) {
  return /^[A-Za-z]{1,5}(\.[A-Za-z])?$/.test(q.trim());
}

function lookupFromUsValueRow(
  row: UsValuePickRow,
  ymd: string,
  date: string,
): UsStockValueLookup {
  return {
    code: row.code,
    name: row.name,
    nameEn: row.nameEn,
    nameZh: row.nameZh,
    close: row.close,
    changePct: row.changePct,
    dayAmt: row.dayAmt,
    nextYearEps: row.nextYearEps,
    baseEps: row.baseEps,
    epsYoy: row.epsYoy,
    forwardPe: row.forwardPe,
    epsSource: row.epsSource,
    revenueYoy: row.revenueYoy ?? null,
    revenueMonth: null,
    brokers: [],
    consensusBasis: null,
    passesScreen: true,
    ymd,
    date,
  };
}

function matchUsRowByQuery(
  rows: UsValuePickRow[],
  q: string,
): UsValuePickRow | null {
  const needle = q.trim().toLowerCase();
  if (!needle) return null;
  if (isUsTickerToken(q)) {
    const upper = q.trim().toUpperCase();
    const byCode = rows.find((r) => r.code.toUpperCase() === upper);
    if (byCode) return byCode;
  }
  return (
    rows.find(
      (r) =>
        r.name.toLowerCase() === needle ||
        r.nameEn?.toLowerCase() === needle ||
        r.nameZh?.toLowerCase() === needle ||
        r.name.toLowerCase().includes(needle) ||
        r.nameEn?.toLowerCase().includes(needle) ||
        r.nameZh?.toLowerCase().includes(needle) ||
        needle.includes((r.nameZh || "").toLowerCase()) ||
        needle.includes((r.nameEn || "").toLowerCase()),
    ) || null
  );
}

/**
 * 以代號或名稱查美股單檔，回傳與價值選股相同口徑。
 * 券商目標價由 /api/us/broker-targets 懶載。
 */
export async function lookupUsStockValue(
  query: string,
): Promise<UsStockValueLookup | null> {
  const q = query.trim();
  if (!q) return null;

  const memoKey = normalizeUsLookupKey(q);
  const memo = usLookupMemoBag();
  const hit = memo.get(memoKey);
  if (hit && Date.now() - hit.at < LOOKUP_MEMO_TTL_MS) {
    return hit.value;
  }

  const vp = await readUsValuePicksCache().catch(() => null);
  if (vp?.rows?.length) {
    const row = matchUsRowByQuery(vp.rows, q);
    if (row) {
      const value = lookupFromUsValueRow(row, vp.ymd, vp.date);
      memo.set(memoKey, { at: Date.now(), value });
      memo.set(normalizeUsLookupKey(row.code), { at: Date.now(), value });
      return value;
    }
  }

  const days = await listUsCachedTradingDays(1, 40);
  const ymd = days[0];
  if (!ymd) return null;
  const quotes = await getUsCachedDayQuotes(ymd);
  if (!quotes?.size) return null;

  let code: string | null = null;
  let quoteName = "";

  if (isUsTickerToken(q)) {
    const upper = q.toUpperCase();
    const row = quotes.get(upper);
    if (row && isUsCommonStock(row.code, row.name)) {
      code = upper;
      quoteName = row.name;
    }
  }

  if (!code) {
    const needle = q.toLowerCase();
    for (const row of quotes.values()) {
      if (!isUsCommonStock(row.code, row.name)) continue;
      const names = resolveUsDisplayNames({
        code: row.code,
        yahooName: row.name,
      });
      if (
        names.name.toLowerCase() === needle ||
        names.nameEn.toLowerCase() === needle ||
        names.nameZh.toLowerCase() === needle ||
        names.name.toLowerCase().includes(needle) ||
        names.nameEn.toLowerCase().includes(needle) ||
        names.nameZh.toLowerCase().includes(needle)
      ) {
        code = row.code.toUpperCase();
        quoteName = row.name;
        break;
      }
    }
  }

  // 中文短名對照表
  if (!code) {
    const needle = q.toLowerCase();
    for (const [sym, zh] of Object.entries(US_NAME_ZH)) {
      if (zh.toLowerCase() === needle || zh.includes(q) || q.includes(zh)) {
        const row = quotes.get(sym);
        if (row && isUsCommonStock(row.code, row.name)) {
          code = sym;
          quoteName = row.name;
          break;
        }
      }
    }
  }

  if (!code) {
    memo.set(memoKey, { at: Date.now(), value: null });
    return null;
  }

  const byCode = memo.get(normalizeUsLookupKey(code));
  if (byCode && Date.now() - byCode.at < LOOKUP_MEMO_TTL_MS) {
    memo.set(memoKey, { at: Date.now(), value: byCode.value });
    return byCode.value;
  }

  const quote = quotes.get(code);
  const close = quote?.close ?? 0;
  const changePct = quote?.changePct ?? 0;
  const dayAmt = round1(usdTurnoverToYi(quote?.turnover ?? 0));
  const names = resolveUsDisplayNames({
    code,
    yahooName: quote?.name || quoteName,
  });

  const auth = await getYahooCrumbAuth();
  const eps = await fetchUsForwardEps(code, auth);
  const nextYearEps = eps?.nextYearEps ?? null;
  const baseEps = eps?.baseEps ?? null;
  const epsYoy =
    nextYearEps != null && baseEps != null && baseEps > 0
      ? round1(((nextYearEps - baseEps) / Math.abs(baseEps)) * 100)
      : null;
  const forwardPe =
    nextYearEps != null && nextYearEps > 0 && close > 0
      ? round1(close / nextYearEps)
      : null;

  const passesScreen = Boolean(
    nextYearEps != null &&
      nextYearEps > 0 &&
      baseEps != null &&
      baseEps > 0 &&
      epsYoy != null &&
      epsYoy > MIN_EPS_YOY &&
      forwardPe != null &&
      forwardPe > 0 &&
      forwardPe < MAX_FORWARD_PE &&
      dayAmt >= MIN_DAY_AMT_YI,
  );

  const value: UsStockValueLookup = {
    code,
    name: names.name,
    nameEn: names.nameEn,
    nameZh: names.nameZh,
    close: round2(close),
    changePct: round2(changePct),
    dayAmt,
    nextYearEps: nextYearEps != null ? round2(nextYearEps) : null,
    baseEps: baseEps != null ? round2(baseEps) : null,
    epsYoy,
    forwardPe,
    epsSource: eps?.source ?? null,
    revenueYoy: eps?.revenueYoy ?? null,
    revenueMonth: null,
    brokers: [],
    consensusBasis: null,
    passesScreen,
    ymd,
    date: ymdToIso(ymd),
  };
  memo.set(memoKey, { at: Date.now(), value });
  memo.set(normalizeUsLookupKey(code), { at: Date.now(), value });
  if (memo.size > 200) {
    const first = memo.keys().next().value;
    if (first) memo.delete(first);
  }
  return value;
}

export const US_VALUE_CRITERIA = {
  minEpsYoy: MIN_EPS_YOY,
  maxForwardPe: MAX_FORWARD_PE,
  minDayAmtYi: MIN_DAY_AMT_YI,
} as const;
