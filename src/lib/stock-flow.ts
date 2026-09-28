/**
 * 個股資金流排行：與板塊相同公式（80% 成交×漲跌 + 20% 法人），
 * 先取當日成交熱門股，再彙總近 5／20 日。
 * 成交金額採「一般成交」口徑（與成值頁相同：總成交 − 盤後定價 − 零股 − 鉅額）。
 */

import type { StockFlow } from "@/lib/types";
import { enrichStockFundamentals } from "@/lib/fundamentals";
import {
  blendFlow,
  instiSharesToYi,
  signedFlowFromQuote,
} from "@/lib/money-flow";
import { applyRegularTurnover } from "@/lib/regular-turnover";
import { isCommonStock } from "@/lib/stock-filter";
import {
  getCachedDayInsti,
  getCachedDayQuotes,
  listCachedTradingDays,
  readCacheFile,
  writeCacheFile,
  ymdToIso,
  type InstiRow,
  type QuoteRow,
} from "@/lib/tw-market";

export type StockFlowRow = StockFlow & {
  /** 近 5 日日均流 − 近 20 日日均流 */
  accel: number;
  /** 近 5 日日均成交 / 近 20 日日均成交 */
  heat: number;
  /** 最新收盤／成交價 */
  close: number;
  revenueYoy?: number | null;
  revenueMonth?: string | null;
  epsGrowth?: number | null;
  nextYearEps?: number | null;
  baseEps?: number | null;
};

export type StockFlowPayload = {
  date: string;
  ymd: string;
  rows: StockFlowRow[];
  builtAt: string;
  source: "cache" | "rebuilt";
  tradingDays: string[];
  /** 成交口徑說明（與成值頁對齊） */
  amountBasis: string;
};

const CACHE = "flow-stocks-latest.json";
const AMOUNT_BASIS =
  "一般成交金額（上市／上櫃總成交 − 盤後定價 − 零股 − 鉅額；對齊 Yahoo／媒體常見口徑）";
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

function flowForQuote(
  q: QuoteRow | undefined,
  insti: InstiRow | undefined,
  turnoverNtd: number,
) {
  if (!q || turnoverNtd <= 0) return null;
  const price = signedFlowFromQuote(turnoverNtd, q.changePct);
  const instiYi =
    insti && q.close > 0 ? instiSharesToYi(insti.total, q.close) : null;
  return blendFlow(price, instiYi);
}

function hasRegularBasis(cached: StockFlowPayload): boolean {
  return cached.amountBasis === AMOUNT_BASIS;
}

export async function buildStockFlowRanking(
  limit = 50,
  options?: { force?: boolean },
): Promise<StockFlowPayload | null> {
  const want = Math.min(100, Math.max(10, limit));

  if (!options?.force) {
    const cached = await readCacheFile<StockFlowPayload>(CACHE);
    if (cached?.rows?.length && hasRegularBasis(cached)) {
      const age = Date.now() - Date.parse(cached.builtAt || "");
      // 日終大包寫入後，盤中／夜間都直接讀快照（約 20 小時）；只有 force 或過期才重算
      if (Number.isFinite(age) && age >= 0 && age < 20 * 60 * 60 * 1000) {
        const rows = cached.rows;
        const needFund = rows.some((r) => r.revenueYoy == null && r.epsGrowth == null);
        if (needFund) {
          try {
            const fund = await enrichStockFundamentals(rows.map((r) => r.code));
            for (const row of rows) {
              const f = fund.get(row.code);
              if (!f) continue;
              row.revenueYoy = f.revenueYoy;
              row.revenueMonth = f.revenueMonth;
              row.epsGrowth = f.epsGrowth;
              row.nextYearEps = f.nextYearEps;
              row.baseEps = f.baseEps;
            }
            await writeCacheFile(CACHE, { ...cached, rows });
          } catch (err) {
            console.error("[stock-flow] fundamentals enrich on cache failed", err);
          }
        }
        return { ...cached, rows, source: "cache" };
      }
    }
  }

  const days = await listCachedTradingDays(20, 60);
  if (days.length < 5) return null;

  const latestQuotes = await getCachedDayQuotes(days[0]);
  if (!latestQuotes?.size) return null;

  const latestRegular = await applyRegularTurnover(latestQuotes, days[0], {
    force: Boolean(options?.force),
  });

  const candidates = [...latestQuotes.values()]
    .filter((q) => isCommonStock(q.code, q.name))
    .map((q) => ({
      q,
      turnover: latestRegular.get(q.code) ?? q.turnover,
    }))
    .filter((x) => x.turnover > 0)
    .sort((a, b) => b.turnover - a.turnover)
    .slice(0, Math.max(want * 2, 80))
    .map((x) => x.q.code);
  const watch = new Set(candidates);

  type DaySnap = {
    ymd: string;
    quotes: Map<string, QuoteRow>;
    regular: Map<string, number>;
    insti: Map<string, InstiRow>;
  };
  const snaps: DaySnap[] = [];
  for (const ymd of days) {
    const quotes = await getCachedDayQuotes(ymd);
    if (!quotes?.size) continue;
    const filtered = new Map<string, QuoteRow>();
    for (const code of watch) {
      const q = quotes.get(code);
      if (q) filtered.set(code, q);
    }
    // 最新日已算過；其餘日用快取排除額（缺檔才打 API）
    const regular =
      ymd === days[0]
        ? latestRegular
        : await applyRegularTurnover(filtered, ymd);
    const instiAll = await getCachedDayInsti(ymd);
    const insti = new Map<string, InstiRow>();
    if (instiAll) {
      for (const code of watch) {
        const row = instiAll.get(code);
        if (row) insti.set(code, row);
      }
    }
    snaps.push({ ymd, quotes: filtered, regular, insti });
  }
  if (snaps.length < 5) return null;

  const latest = snaps[0];
  const d3 = snaps.slice(0, Math.min(3, snaps.length));
  const d5 = snaps.slice(0, Math.min(5, snaps.length));
  const d20 = snaps.slice(0, Math.min(20, snaps.length));
  const n5 = d5.length;
  const n20 = d20.length;

  const rows: StockFlowRow[] = [];
  for (const code of candidates) {
    const latestQ = latest.quotes.get(code);
    if (!latestQ) continue;
    const latestTurnover = latest.regular.get(code) ?? latestQ.turnover;
    const dayParts = flowForQuote(
      latestQ,
      latest.insti.get(code),
      latestTurnover,
    );
    if (!dayParts) continue;

    let d3Amt = 0;
    let d3Flow = 0;
    for (const day of d3) {
      const q = day.quotes.get(code);
      const p = flowForQuote(
        q,
        day.insti.get(code),
        q ? (day.regular.get(code) ?? q.turnover) : 0,
      );
      if (!p) continue;
      d3Amt += p.amt;
      d3Flow += p.flow;
    }

    let d5Amt = 0;
    let d5Flow = 0;
    for (const day of d5) {
      const q = day.quotes.get(code);
      const p = flowForQuote(
        q,
        day.insti.get(code),
        q ? (day.regular.get(code) ?? q.turnover) : 0,
      );
      if (!p) continue;
      d5Amt += p.amt;
      d5Flow += p.flow;
    }

    let d20Amt = 0;
    let d20Flow = 0;
    for (const day of d20) {
      const q = day.quotes.get(code);
      const p = flowForQuote(
        q,
        day.insti.get(code),
        q ? (day.regular.get(code) ?? q.turnover) : 0,
      );
      if (!p) continue;
      d20Amt += p.amt;
      d20Flow += p.flow;
    }

    const avg5Flow = d5Flow / Math.max(n5, 1);
    const avg20Flow = d20Flow / Math.max(n20, 1);
    const avg5Amt = d5Amt / Math.max(n5, 1);
    const avg20Amt = d20Amt / Math.max(n20, 1);

    rows.push({
      code,
      name: latestQ.name.trim() || code,
      dayAmt: round2(dayParts.amt),
      dayFlow: round1(dayParts.flow),
      dayIn: round1(dayParts.inflow),
      dayOut: round1(dayParts.outflow),
      d3Flow: round1(d3Flow),
      d5Flow: round1(d5Flow),
      d20Flow: round1(d20Flow),
      d3: round1(d3Amt),
      d5: round1(d5Amt),
      d20: round1(d20Amt),
      changePct: round2(latestQ.changePct),
      close: round2(latestQ.close),
      accel: round1(avg5Flow - avg20Flow),
      heat: avg20Amt > 0 ? round2(avg5Amt / avg20Amt) : 1,
    });
  }

  rows.sort((a, b) => b.dayAmt - a.dayAmt);
  const top = rows.slice(0, want);

  try {
    const fund = await enrichStockFundamentals(
      top.map((r) => r.code),
      { force: Boolean(options?.force) },
    );
    for (const row of top) {
      const f = fund.get(row.code);
      if (!f) continue;
      row.revenueYoy = f.revenueYoy;
      row.revenueMonth = f.revenueMonth;
      row.epsGrowth = f.epsGrowth;
      row.nextYearEps = f.nextYearEps;
      row.baseEps = f.baseEps;
    }
  } catch (err) {
    console.error("[stock-flow] fundamentals enrich failed", err);
  }

  const payload: StockFlowPayload = {
    date: ymdToIso(days[0]),
    ymd: days[0],
    rows: top,
    builtAt: new Date().toISOString(),
    source: "rebuilt",
    tradingDays: snaps.map((s) => s.ymd),
    amountBasis: AMOUNT_BASIS,
  };
  await writeCacheFile(CACHE, payload);
  return payload;
}
