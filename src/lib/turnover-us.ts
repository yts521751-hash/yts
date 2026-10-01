/**
 * 美股成交金額排行（正規盤 close×volume，單位億美元）。
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
  /** 億美元 */
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
  market: "us";
};

const AMOUNT_BASIS =
  "美股正規盤成交金額（Yahoo regular session：收盤價 × 成交股數；單位億美元）";
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const YI = 1e8;

export async function buildUsTurnoverRanking(
  limit = 50,
  options?: { force?: boolean },
): Promise<UsTurnoverPayload | null> {
  const want = Math.min(100, Math.max(10, limit));
  if (!options?.force) {
    const cached = await readUsCacheFile<UsTurnoverPayload>(US_TURNOVER_CACHE);
    if (cached?.rows?.length) {
      return { ...cached, rows: cached.rows.slice(0, want), source: "cache" };
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
      dayAmt: round1(q.turnover / YI),
      volume: q.volume ?? 0,
    }));

  const payload: UsTurnoverPayload = {
    date: ymdToIso(days[0]),
    ymd: days[0],
    rows,
    builtAt: new Date().toISOString(),
    source: "rebuilt",
    amountBasis: AMOUNT_BASIS,
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
      return { ...cached, rows: cached.rows.slice(0, want), source: "cache" };
    }
  }
  return buildUsTurnoverRanking(want, options);
}
