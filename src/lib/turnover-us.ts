/**
 * 美股成交金額排行（正規盤 close×volume，單位億美元）。
 *
 * 公式：dayAmtYi = (收盤價 USD × 成交股數) / 1e8
 * 例：MU 收盤 1065、量 3050 萬股 → 約 325 億美元（與市場美元成交額同口徑）。
 * 不含盤後；不套用台股 regular-turnover 排除。
 */

import {
  US_TURNOVER_CACHE,
  getUsCachedDayQuotes,
  isUsCommonStock,
  listUsCachedTradingDays,
  readUsCacheFile,
  writeUsCacheFile,
  ymdToIso,
} from "@/lib/us-market";

export type UsTurnoverRow = {
  rank: number;
  code: string;
  name: string;
  close: number;
  changePct: number;
  /** 億美元（USD dollar volume / 1e8） */
  dayAmt: number;
  volume: number;
};

export type UsTurnoverPayload = {
  date: string;
  ymd: string;
  rows: UsTurnoverRow[];
  builtAt: string;
  source: "cache" | "rebuilt";
  amountBasis: string;
  /** 顯示單位說明 */
  unit: "億美元";
  market: "us";
};

const AMOUNT_BASIS =
  "美股正規盤成交金額＝收盤價(USD)×成交股數÷1e8（單位：億美元；Yahoo daily bar，不含盤後）";
/** 1 億美元 */
export const US_YI_USD = 1e8;
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** 美元成交額 → 億美元 */
export function usdTurnoverToYi(dollarVolume: number): number {
  return dollarVolume / US_YI_USD;
}

export async function buildUsTurnoverRanking(
  limit = 50,
  options?: { force?: boolean },
): Promise<UsTurnoverPayload | null> {
  const want = Math.min(100, Math.max(10, limit));
  if (!options?.force) {
    const cached = await readUsCacheFile<UsTurnoverPayload>(US_TURNOVER_CACHE);
    if (cached?.rows?.length) {
      return {
        ...cached,
        rows: cached.rows.slice(0, want),
        source: "cache",
        unit: "億美元",
      };
    }
  }

  const days = await listUsCachedTradingDays(1, 40);
  if (!days.length) return null;
  const quotes = await getUsCachedDayQuotes(days[0]);
  if (!quotes?.size) return null;

  const rows = [...quotes.values()]
    .filter((q) => isUsCommonStock(q.code, q.name) && q.turnover > 0)
    .sort((a, b) => b.turnover - a.turnover)
    .slice(0, want)
    .map((q, i) => ({
      rank: i + 1,
      code: q.code.toUpperCase(),
      name: q.name || q.code,
      close: round2(q.close),
      changePct: round2(q.changePct),
      dayAmt: round1(usdTurnoverToYi(q.turnover)),
      volume: q.volume ?? 0,
    }));

  const payload: UsTurnoverPayload = {
    date: ymdToIso(days[0]),
    ymd: days[0],
    rows,
    builtAt: new Date().toISOString(),
    source: "rebuilt",
    amountBasis: AMOUNT_BASIS,
    unit: "億美元",
    market: "us",
  };
  await writeUsCacheFile(US_TURNOVER_CACHE, payload);
  return payload;
}

export async function getUsTurnoverRanking(
  limit = 50,
  options?: { force?: boolean },
): Promise<UsTurnoverPayload | null> {
  const want = Math.min(100, Math.max(10, limit));
  if (!options?.force) {
    const cached = await readUsCacheFile<UsTurnoverPayload>(US_TURNOVER_CACHE);
    if (cached?.rows?.length) {
      return {
        ...cached,
        rows: cached.rows.slice(0, want),
        source: "cache",
        unit: "億美元",
      };
    }
  }
  return buildUsTurnoverRanking(want, options);
}
