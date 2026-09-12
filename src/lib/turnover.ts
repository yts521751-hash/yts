import {
  listCachedTradingDays,
  listRecentTradingDays,
  getCachedDayQuotes,
  readCacheFile,
  writeCacheFile,
  ymdToIso,
  type QuoteRow,
} from "@/lib/tw-market";

export type TurnoverRow = {
  rank: number;
  code: string;
  name: string;
  turnoverYi: number;
  changePct: number;
  close: number;
};

export type TurnoverPayload = {
  date: string;
  ymd: string;
  rows: TurnoverRow[];
  builtAt: string;
  source: "cache";
  total: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function isCommonStock(code: string) {
  // 排除 ETF／債券等：一般股票代號 4 碼數字
  return /^\d{4}$/.test(code);
}

/** 當日全市場成交金額排行（只讀本機 quotes 快取） */
export async function buildTurnoverRanking(
  limit = 100,
): Promise<TurnoverPayload | null> {
  const days = await listCachedTradingDays(1, 30);
  if (!days.length) return null;
  const ymd = days[0];
  const map = await getCachedDayQuotes(ymd);
  if (!map?.size) return null;

  const rows = [...map.values()]
    .filter((q) => isCommonStock(q.code) && q.turnover > 0)
    .sort((a, b) => b.turnover - a.turnover)
    .slice(0, Math.min(200, Math.max(10, limit)))
    .map((q, i) => ({
      rank: i + 1,
      code: q.code,
      name: q.name,
      turnoverYi: round2(q.turnover / 1e8),
      changePct: round2(q.changePct),
      close: round2(q.close),
    }));

  return {
    date: ymdToIso(ymd),
    ymd,
    rows,
    builtAt: new Date().toISOString(),
    source: "cache",
    total: rows.length,
  };
}

/** 背景補齊較長行情快取，供 MA60／更長日線使用 */
export async function ensureQuoteHistory(needDays = 80) {
  const have = await listCachedTradingDays(needDays, 160);
  if (have.length >= needDays) return have;
  return listRecentTradingDays(needDays, 160);
}

export type { QuoteRow };
