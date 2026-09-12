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
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function isCommonStock(code: string) {
  return /^\d{4}$/.test(code);
}

function taipeiHour() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    hour: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  return { hour, weekday };
}

/** 盤中嘗試刷新當日行情；盤後／假日只讀快取 */
export async function buildTurnoverRanking(
  limit = 50,
  options?: { live?: boolean },
): Promise<TurnoverPayload | null> {
  const want = Math.min(50, Math.max(1, limit));
  const { hour, weekday } = taipeiHour();
  const isWeekday = !["Sat", "Sun"].includes(weekday);
  const inSession = isWeekday && hour >= 9 && hour < 14;
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
  };
}

export async function ensureQuoteHistory(needDays = 80) {
  const have = await listCachedTradingDays(needDays, 160);
  if (have.length >= needDays) return have;
  return listRecentTradingDays(needDays, 160);
}

export type { QuoteRow };
