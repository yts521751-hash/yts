"use client";

import type { MarketBrief, SectorFlow } from "@/lib/types";
import { formatYi, formatYiSigned, signedClass } from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = {
  market: MarketBrief;
  volumeSpikes: SectorFlow[];
  topTurnover: SectorFlow[];
  onSelect: (s: SectorFlow) => void;
};

export function FocusPanel({
  market,
  volumeSpikes,
  topTurnover,
  onSelect,
}: Props) {
  const showSpike = market.indexChangePct <= -1 && volumeSpikes.length > 0;
  const items = showSpike ? volumeSpikes : topTurnover;

  return (
    <section className="rounded-2xl border border-border/60 bg-[var(--panel)]/70 p-4 backdrop-blur-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold tracking-tight">
          {showSpike ? "大跌日異常放量" : "今日淨流入最多"}
        </h2>
        <div className="rounded-xl bg-muted/50 px-3 py-1.5 text-right text-xs">
          <p className="text-muted-foreground">加權漲跌</p>
          <p
            className={cn(
              "font-semibold tabular-nums",
              market.indexChangePct < 0
                ? "text-[var(--tide-down)]"
                : "text-[var(--tide-up)]",
            )}
          >
            {market.indexChangePct > 0 ? "+" : ""}
            {market.indexChangePct.toFixed(2)}%
          </p>
        </div>
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onSelect(s)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-border/40 bg-background/50 px-3 py-2.5 text-left transition hover:border-border hover:bg-muted/40"
            >
              <span className="truncate font-medium">{s.name}</span>
              <span
                className={cn(
                  "shrink-0 tabular-nums text-sm font-semibold",
                  showSpike ? undefined : signedClass(s.dayFlow),
                )}
              >
                {showSpike ? formatYi(s.dayAmt) : formatYiSigned(s.dayFlow)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
