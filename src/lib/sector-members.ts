import "server-only";
import {
  getCachedDayQuotes,
  listCachedTradingDays,
} from "@/lib/tw-market";

export type SectorMemberView = {
  code: string;
  name: string;
  /** 最近交易日成交金額（億元） */
  dayAmt: number;
};

/** 成分股附上最新成交值，並依成交值由高到低排序 */
export async function membersWithTurnover(
  members: { code: string; name: string }[],
): Promise<{ members: SectorMemberView[]; asOf: string | null }> {
  const days = await listCachedTradingDays(1, 40);
  const asOf = days[0] ?? null;
  const quotes = asOf ? ((await getCachedDayQuotes(asOf)) ?? new Map()) : new Map();

  const enriched: SectorMemberView[] = members.map((m) => {
    const q = quotes.get(m.code);
    const turnover = q?.turnover ?? 0;
    return {
      code: m.code,
      name: m.name || q?.name || m.code,
      dayAmt: Math.round((turnover / 1e8) * 100) / 100,
    };
  });

  enriched.sort(
    (a, b) => b.dayAmt - a.dayAmt || a.code.localeCompare(b.code),
  );

  return { members: enriched, asOf };
}
