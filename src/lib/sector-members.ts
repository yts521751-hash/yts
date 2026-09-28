import "server-only";
import { applyRegularTurnover } from "@/lib/regular-turnover";
import {
  getCachedDayQuotes,
  listCachedTradingDays,
  ymdToIso,
} from "@/lib/tw-market";

export type SectorMemberView = {
  code: string;
  name: string;
  /** 最近交易日一般成交金額（億元；與成值頁同口徑） */
  dayAmt: number;
};

/** 成分股附上最新一般成交值，並依成交值由高到低排序 */
export async function membersWithTurnover(
  members: { code: string; name: string }[],
): Promise<{ members: SectorMemberView[]; asOf: string | null }> {
  const days = await listCachedTradingDays(1, 40);
  const ymd = days[0] ?? null;
  const quotes = ymd ? ((await getCachedDayQuotes(ymd)) ?? new Map()) : new Map();
  const regular = ymd
    ? await applyRegularTurnover(quotes, ymd)
    : new Map<string, number>();

  const enriched: SectorMemberView[] = members.map((m) => {
    const q = quotes.get(m.code);
    const turnover = regular.get(m.code) ?? q?.turnover ?? 0;
    return {
      code: m.code,
      name: m.name || q?.name || m.code,
      dayAmt: Math.round((turnover / 1e8) * 100) / 100,
    };
  });

  enriched.sort(
    (a, b) => b.dayAmt - a.dayAmt || a.code.localeCompare(b.code),
  );

  return { members: enriched, asOf: ymd ? ymdToIso(ymd) : null };
}
