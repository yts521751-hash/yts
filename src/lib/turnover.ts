import { isCommonStock } from "@/lib/stock-filter";
import { applyRegularTurnover } from "@/lib/regular-turnover";
import {
  listCachedTradingDays,
  listRecentTradingDays,
  getCachedDayQuotes,
  readCacheFile,
  writeCacheFile,
  ymdToIso,
  HISTORY_CALENDAR_LOOKBACK,
  HISTORY_TRADING_DAYS,
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
  source: "cache" | "rebuilt";
  total: number;
  /** 已不再做盤中即時；固定 false 以相容前端 */
  inSession: boolean;
  sessionNote: string;
  /** 成交口徑說明 */
  amountBasis: string;
};

const CACHE = "turnover-ranking-latest.json";
const round2 = (n: number) => Math.round(n * 100) / 100;

const AMOUNT_BASIS =
  "一般成交金額（上市／上櫃總成交 − 盤後定價 − 零股 − 鉅額；對齊 Yahoo／媒體常見口徑）";

const SESSION_NOTE =
  "每日收盤後隨日終大包更新（約 18:00／18:30／19:00），不做盤中即時輪詢";

async function rankDay(
  ymd: string,
  want: number,
  source: TurnoverPayload["source"],
  options?: { forceExclusions?: boolean },
): Promise<TurnoverPayload | null> {
  const map = await getCachedDayQuotes(ymd);
  if (!map?.size) return null;

  const regular = await applyRegularTurnover(map, ymd, {
    force: Boolean(options?.forceExclusions),
  });

  const rows = [...map.values()]
    .filter((q) => isCommonStock(q.code, q.name))
    .map((q) => ({
      q,
      turnover: regular.get(q.code) ?? q.turnover,
    }))
    .filter((x) => x.turnover > 0)
    .sort((a, b) => b.turnover - a.turnover)
    .slice(0, want)
    .map(({ q, turnover }, i) => ({
      rank: i + 1,
      code: q.code,
      name: q.name.trim(),
      turnoverYi: round2(turnover / 1e8),
      changePct: round2(q.changePct),
      close: round2(q.close),
    }));

  if (!rows.length) return null;

  return {
    date: ymdToIso(ymd),
    ymd,
    rows,
    builtAt: new Date().toISOString(),
    source,
    total: rows.length,
    inSession: false,
    sessionNote: SESSION_NOTE,
    amountBasis: AMOUNT_BASIS,
  };
}

/** 讀取日終成交排行快照；缺資料或 force 時重算並寫入 */
export async function buildTurnoverRanking(
  limit = 50,
  options?: { live?: boolean; force?: boolean },
): Promise<TurnoverPayload | null> {
  const want = Math.min(50, Math.max(1, limit));
  // live 參數保留相容，但不再做盤中即時抓取
  void options?.live;

  if (!options?.force) {
    const cached = await readCacheFile<TurnoverPayload>(CACHE);
    if (cached?.rows?.length) {
      const age = Date.now() - Date.parse(cached.builtAt || "");
      if (Number.isFinite(age) && age >= 0 && age < 36 * 60 * 60 * 1000) {
        return {
          ...cached,
          rows: cached.rows.slice(0, want),
          total: Math.min(cached.total, want),
          source: "cache",
          inSession: false,
          sessionNote: SESSION_NOTE,
          amountBasis: cached.amountBasis || AMOUNT_BASIS,
        };
      }
    }
  }

  const days = await listCachedTradingDays(1, 30);
  const ymd = days[0];
  if (!ymd) return null;

  const payload = await rankDay(ymd, want, "rebuilt", {
    forceExclusions: Boolean(options?.force),
  });
  if (!payload) return null;
  await writeCacheFile(CACHE, payload);
  return payload;
}

/** 補齊報價日檔到近約 60 個交易日（HISTORY_TRADING_DAYS） */
export async function ensureQuoteHistory(
  needDays = HISTORY_TRADING_DAYS,
  options?: { onProgress?: (done: number, need: number) => void },
) {
  const lookback = Math.max(
    HISTORY_CALENDAR_LOOKBACK,
    Math.ceil(needDays * 2.2),
  );
  const have = await listCachedTradingDays(needDays, lookback);
  if (have.length >= needDays) {
    options?.onProgress?.(have.length, needDays);
    return have;
  }
  return listRecentTradingDays(needDays, lookback, {
    onProgress: options?.onProgress,
  });
}

export type { QuoteRow };
