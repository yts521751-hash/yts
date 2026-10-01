/**
 * 美股個股金流排行：80% 成交×漲跌 + 20% 相對成交量。
 * 成交口徑：Yahoo regular session 成交金額（close × volume）。
 */

import type { StockFlow } from "@/lib/types";
import { blendUsFlow } from "@/lib/money-flow";
import {
  US_STOCKS_FLOW_CACHE,
  computeRvolForCode,
  getUsCachedDayQuotes,
  isUsCommonStock,
  listUsCachedTradingDays,
  readUsCacheFile,
  writeUsCacheFile,
  ymdToIso,
  type UsQuoteRow,
} from "@/lib/us-market";

export type UsStockFlowRow = StockFlow & {
  accel: number;
  heat: number;
  close: number;
  rvol?: number | null;
};

export type UsStockFlowPayload = {
  date: string;
  ymd: string;
  rows: UsStockFlowRow[];
  builtAt: string;
  source: "cache" | "rebuilt";
  tradingDays: string[];
  amountBasis: string;
  market: "us";
  flowLabel: string;
  formula: "us-blend-80-20-rvol";
};

const AMOUNT_BASIS =
  "美股正規盤成交金額（Yahoo regular session：收盤價 × 成交股數；單位億美元）";
const FLOW_LABEL = "美股金流（成交×漲跌＋相對成交量）";
const CACHE_TTL_MS = 20 * 60 * 60 * 1000;
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

function flowBag() {
  const g = globalThis as typeof globalThis & {
    __jinliuUsStockFlow?: {
      rebuilding: boolean;
      promise: Promise<UsStockFlowPayload | null> | null;
    };
  };
  if (!g.__jinliuUsStockFlow) {
    g.__jinliuUsStockFlow = { rebuilding: false, promise: null };
  }
  return g.__jinliuUsStockFlow;
}

function isFresh(cached: UsStockFlowPayload): boolean {
  const age = Date.now() - Date.parse(cached.builtAt || "");
  return Number.isFinite(age) && age >= 0 && age < CACHE_TTL_MS;
}

export async function buildUsStockFlowRanking(
  limit = 50,
  options?: { force?: boolean },
): Promise<UsStockFlowPayload | null> {
  const want = Math.min(100, Math.max(10, limit));
  const force = Boolean(options?.force);

  if (!force) {
    const cached = await readUsCacheFile<UsStockFlowPayload>(US_STOCKS_FLOW_CACHE);
    if (cached?.rows?.length && cached.amountBasis === AMOUNT_BASIS && isFresh(cached)) {
      return { ...cached, rows: cached.rows.slice(0, want), source: "cache" };
    }
  }

  const days = await listUsCachedTradingDays(20, 60);
  if (days.length < 5) return null;

  const quotesByDay = new Map<string, Map<string, UsQuoteRow>>();
  for (const ymd of days) {
    const q = await getUsCachedDayQuotes(ymd);
    if (q?.size) quotesByDay.set(ymd, q);
  }
  if (!quotesByDay.get(days[0])?.size) return null;

  const latestQuotes = quotesByDay.get(days[0])!;
  const candidates = [...latestQuotes.values()]
    .filter((q) => isUsCommonStock(q.code, q.name) && q.turnover > 0)
    .sort((a, b) => b.turnover - a.turnover)
    .slice(0, Math.max(want * 2, 80))
    .map((q) => q.code.toUpperCase());

  const d3 = days.slice(0, Math.min(3, days.length));
  const d5 = days.slice(0, Math.min(5, days.length));
  const d20 = days.slice(0, Math.min(20, days.length));
  const n5 = d5.length;
  const n20 = d20.length;

  const rows: UsStockFlowRow[] = [];
  for (const code of candidates) {
    const latestQ = latestQuotes.get(code);
    if (!latestQ) continue;
    const rvol = computeRvolForCode(code, days, quotesByDay, 0);
    const dayParts = blendUsFlow(latestQ.turnover, latestQ.changePct, rvol);
    if (!dayParts) continue;

    let d3Amt = 0;
    let d3Flow = 0;
    d3.forEach((ymd, idx) => {
      const q = quotesByDay.get(ymd)?.get(code);
      if (!q) return;
      const rv = computeRvolForCode(code, days, quotesByDay, idx);
      const p = blendUsFlow(q.turnover, q.changePct, rv);
      d3Amt += p.amt;
      d3Flow += p.flow;
    });

    let d5Amt = 0;
    let d5Flow = 0;
    d5.forEach((ymd, idx) => {
      const q = quotesByDay.get(ymd)?.get(code);
      if (!q) return;
      const rv = computeRvolForCode(code, days, quotesByDay, idx);
      const p = blendUsFlow(q.turnover, q.changePct, rv);
      d5Amt += p.amt;
      d5Flow += p.flow;
    });

    let d20Amt = 0;
    let d20Flow = 0;
    d20.forEach((ymd, idx) => {
      const q = quotesByDay.get(ymd)?.get(code);
      if (!q) return;
      const rv = computeRvolForCode(code, days, quotesByDay, idx);
      const p = blendUsFlow(q.turnover, q.changePct, rv);
      d20Amt += p.amt;
      d20Flow += p.flow;
    });

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
      rvol: rvol != null ? round2(rvol) : null,
    });
  }

  rows.sort((a, b) => b.dayAmt - a.dayAmt);
  const top = rows.slice(0, want);
  const payload: UsStockFlowPayload = {
    date: ymdToIso(days[0]),
    ymd: days[0],
    rows: top,
    builtAt: new Date().toISOString(),
    source: "rebuilt",
    tradingDays: days,
    amountBasis: AMOUNT_BASIS,
    market: "us",
    flowLabel: FLOW_LABEL,
    formula: "us-blend-80-20-rvol",
  };
  await writeUsCacheFile(US_STOCKS_FLOW_CACHE, payload);
  return payload;
}

export function buildUsStockFlowRankingSingleFlight(
  limit = 50,
  options?: { force?: boolean },
): Promise<UsStockFlowPayload | null> {
  const bag = flowBag();
  if (bag.promise) return bag.promise;
  bag.rebuilding = true;
  bag.promise = buildUsStockFlowRanking(limit, options)
    .catch((err) => {
      console.error("[us-stock-flow] rebuild failed", err);
      return null;
    })
    .finally(() => {
      bag.rebuilding = false;
      bag.promise = null;
    });
  return bag.promise;
}

export function requestUsStockFlowRebuild(
  reason: string,
  options?: { force?: boolean; limit?: number },
): { started: boolean; alreadyRunning: boolean } {
  const bag = flowBag();
  if (bag.rebuilding || bag.promise) {
    return { started: false, alreadyRunning: true };
  }
  console.log(`[us-stock-flow] background rebuild (${reason})`);
  void buildUsStockFlowRankingSingleFlight(options?.limit ?? 50, {
    force: Boolean(options?.force),
  });
  return { started: true, alreadyRunning: false };
}

export async function getUsStockFlowRanking(
  limit = 50,
  options?: { force?: boolean },
): Promise<UsStockFlowPayload | null> {
  const want = Math.min(100, Math.max(10, limit));
  const force = Boolean(options?.force);
  const cached = await readUsCacheFile<UsStockFlowPayload>(US_STOCKS_FLOW_CACHE);

  if (cached?.rows?.length) {
    const needsRebuild =
      force || cached.amountBasis !== AMOUNT_BASIS || !isFresh(cached);
    if (needsRebuild) {
      requestUsStockFlowRebuild(force ? "api-force" : "stale", {
        force,
        limit: want,
      });
    }
    return {
      ...cached,
      rows: cached.rows.slice(0, want),
      source: "cache",
      market: "us",
      flowLabel: FLOW_LABEL,
      formula: "us-blend-80-20-rvol",
    };
  }

  return buildUsStockFlowRankingSingleFlight(want, { force });
}
