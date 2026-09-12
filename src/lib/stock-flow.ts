/**
 * 個股資金流排行：與板塊相同公式（80% 成交×漲跌 + 20% 法人），
 * 先取當日成交熱門股，再彙總近 5／20 日。
 */

import type { StockFlow } from "@/lib/types";
import {
  blendFlow,
  instiSharesToYi,
  signedFlowFromQuote,
} from "@/lib/money-flow";
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
};

export type StockFlowPayload = {
  date: string;
  ymd: string;
  rows: StockFlowRow[];
  builtAt: string;
  source: "cache" | "rebuilt";
  tradingDays: string[];
};

const CACHE = "flow-stocks-latest.json";
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

function isCommonStock(code: string) {
  return /^\d{4}$/.test(code);
}

function flowForQuote(
  q: QuoteRow | undefined,
  insti: InstiRow | undefined,
) {
  if (!q || q.turnover <= 0) return null;
  const price = signedFlowFromQuote(q.turnover, q.changePct);
  const instiYi =
    insti && q.close > 0 ? instiSharesToYi(insti.total, q.close) : null;
  return blendFlow(price, instiYi);
}

export async function buildStockFlowRanking(
  limit = 50,
  options?: { force?: boolean },
): Promise<StockFlowPayload | null> {
  const want = Math.min(100, Math.max(10, limit));

  if (!options?.force) {
    const cached = await readCacheFile<StockFlowPayload>(CACHE);
    if (cached?.rows?.length) {
      const age = Date.now() - Date.parse(cached.builtAt || "");
      if (Number.isFinite(age) && age >= 0 && age < 10 * 60 * 1000) {
        return { ...cached, source: "cache" };
      }
    }
  }

  const days = await listCachedTradingDays(20, 60);
  if (days.length < 5) return null;

  const latestQuotes = await getCachedDayQuotes(days[0]);
  if (!latestQuotes?.size) return null;

  const candidates = [...latestQuotes.values()]
    .filter((q) => isCommonStock(q.code) && q.turnover > 0)
    .sort((a, b) => b.turnover - a.turnover)
    .slice(0, Math.max(want * 2, 80))
    .map((q) => q.code);
  const watch = new Set(candidates);

  type DaySnap = {
    ymd: string;
    quotes: Map<string, QuoteRow>;
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
    const instiAll = await getCachedDayInsti(ymd);
    const insti = new Map<string, InstiRow>();
    if (instiAll) {
      for (const code of watch) {
        const row = instiAll.get(code);
        if (row) insti.set(code, row);
      }
    }
    snaps.push({ ymd, quotes: filtered, insti });
  }
  if (snaps.length < 5) return null;

  const latest = snaps[0];
  const d5 = snaps.slice(0, Math.min(5, snaps.length));
  const d20 = snaps.slice(0, Math.min(20, snaps.length));
  const n5 = d5.length;
  const n20 = d20.length;

  const rows: StockFlowRow[] = [];
  for (const code of candidates) {
    const latestQ = latest.quotes.get(code);
    if (!latestQ) continue;
    const dayParts = flowForQuote(latestQ, latest.insti.get(code));
    if (!dayParts) continue;

    let d5Amt = 0;
    let d5Flow = 0;
    for (const day of d5) {
      const p = flowForQuote(day.quotes.get(code), day.insti.get(code));
      if (!p) continue;
      d5Amt += p.amt;
      d5Flow += p.flow;
    }

    let d20Amt = 0;
    let d20Flow = 0;
    for (const day of d20) {
      const p = flowForQuote(day.quotes.get(code), day.insti.get(code));
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
      dayAmt: round1(dayParts.amt),
      dayFlow: round1(dayParts.flow),
      dayIn: round1(dayParts.inflow),
      dayOut: round1(dayParts.outflow),
      d5Flow: round1(d5Flow),
      d20Flow: round1(d20Flow),
      d5: round1(d5Amt),
      d20: round1(d20Amt),
      changePct: round2(latestQ.changePct),
      accel: round1(avg5Flow - avg20Flow),
      heat: avg20Amt > 0 ? round2(avg5Amt / avg20Amt) : 1,
    });
  }

  rows.sort((a, b) => b.dayAmt - a.dayAmt);
  const top = rows.slice(0, want);

  const payload: StockFlowPayload = {
    date: ymdToIso(days[0]),
    ymd: days[0],
    rows: top,
    builtAt: new Date().toISOString(),
    source: "rebuilt",
    tradingDays: snaps.map((s) => s.ymd),
  };
  await writeCacheFile(CACHE, payload);
  return payload;
}
