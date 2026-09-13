import {
  listCachedTradingDays,
  listRecentTradingDays,
  getCachedDayQuotes,
  loadMergedQuotesDay,
  toYmd,
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
  source: "cache" | "live-refresh";
  total: number;
  /** 台北時間是否在盤中（09:00–13:35） */
  inSession: boolean;
  sessionNote: string;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** 盤中 live 結果短快取，避免前端 3 秒輪詢打爆交易所 */
const LIVE_TTL_MS = 3_000;
let liveMemo: { at: number; payload: TurnoverPayload } | null = null;

function isCommonStock(code: string) {
  return /^\d{4}$/.test(code);
}

function taipeiSession() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const isWeekday = !["Sat", "Sun"].includes(weekday);
  const mins = hour * 60 + minute;
  // 08:55 起進入即時模式（開盤前預熱），至 13:35（含尾盤撮合緩衝）
  const inSession = isWeekday && mins >= 8 * 60 + 55 && mins < 13 * 60 + 35;
  return { hour, minute, weekday, isWeekday, inSession, mins };
}

function rankFromQuotes(
  map: Map<string, QuoteRow>,
  ymd: string,
  want: number,
  source: TurnoverPayload["source"],
  inSession: boolean,
): TurnoverPayload {
  const rows = [...map.values()]
    .filter((q) => isCommonStock(q.code) && q.turnover > 0)
    .sort((a, b) => b.turnover - a.turnover)
    .slice(0, want)
    .map((q, i) => ({
      rank: i + 1,
      code: q.code,
      name: q.name.trim(),
      turnoverYi: round2(q.turnover / 1e8),
      changePct: round2(q.changePct),
      close: round2(q.close),
    }));

  return {
    date: ymdToIso(ymd),
    ymd,
    rows,
    builtAt: new Date().toISOString(),
    source,
    total: rows.length,
    inSession,
    sessionNote: inSession
      ? "開盤預熱／盤中即時：約每 3 秒重抓證交所／櫃買公開行情並刷新表格（平日 08:55 起）"
      : "休市／週末：維持上個交易日排行，不自動刷新；平日約 08:55 起自動改為即時",
  };
}

/** 盤中嘗試刷新當日行情；盤後／假日只讀快取 */
export async function buildTurnoverRanking(
  limit = 50,
  options?: { live?: boolean },
): Promise<TurnoverPayload | null> {
  const want = Math.min(50, Math.max(1, limit));
  const { inSession } = taipeiSession();

  if (options?.live && inSession && liveMemo) {
    const age = Date.now() - liveMemo.at;
    if (age >= 0 && age < LIVE_TTL_MS) return liveMemo.payload;
  }

  let source: TurnoverPayload["source"] = "cache";
  let days = await listCachedTradingDays(1, 30);
  let ymd = days[0];

  if (options?.live && inSession) {
    const today = toYmd(new Date());
    try {
      const fresh = await loadMergedQuotesDay(today, { force: true });
      if (fresh?.quotes?.length) {
        ymd = today;
        source = "live-refresh";
        const map = new Map(fresh.quotes.map((q) => [q.code, q]));
        const payload = rankFromQuotes(map, ymd, want, source, inSession);
        liveMemo = { at: Date.now(), payload };
        return payload;
      }
    } catch {
      /* keep cache */
    }
  }

  if (!ymd) {
    days = await listCachedTradingDays(1, 30);
    ymd = days[0];
  }
  if (!ymd) return null;

  const map = await getCachedDayQuotes(ymd);
  if (!map?.size) return null;

  const payload = rankFromQuotes(map, ymd, want, source, inSession);
  if (options?.live && inSession) {
    liveMemo = { at: Date.now(), payload };
  }
  return payload;
}

export async function ensureQuoteHistory(needDays = 80) {
  const have = await listCachedTradingDays(needDays, 160);
  if (have.length >= needDays) return have;
  return listRecentTradingDays(needDays, 160);
}

export type { QuoteRow };
