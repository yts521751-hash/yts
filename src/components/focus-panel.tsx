"use client";

import type { MarketBrief, SectorFlow } from "@/lib/types";
import { formatYi } from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = {
  market: MarketBrief;
  contrarian: SectorFlow[];
  topBuys: SectorFlow[];
  onSelect: (s: SectorFlow) => void;
};

export function FocusPanel({ market, contrarian, topBuys, onSelect }: Props) {
  const showContrarian = market.indexChangePct <= -1 && contrarian.length > 0;
  const items = showContrarian ? contrarian : topBuys;

  return (
    <section className="rounded-2xl border border-border/60 bg-[var(--panel)]/70 p-4 backdrop-blur-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold tracking-tight">
            {showContrarian ? "⚓ 大跌日法人買超的板塊" : "今日法人買最多"}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {showContrarian
              ? "大盤跌逾 1%，這些板塊自己也跌，法人卻異常大買——用來縮小注意範圍，不是買賣點。"
              : "大盤未重挫時，改看近 5 日法人買超最多的板塊。"}
          </p>
        </div>
        <div className="rounded-xl bg-muted/50 px-3 py-1.5 text-right text-xs">
          <p className="text-muted-foreground">加權漲跌</p>
          <p
            className={cn(
              "font-semibold tabular-nums",
              market.indexChangePct < 0 ? "text-[var(--tide-down)]" : "text-[var(--tide-up)]",
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
              <span className="shrink-0 tabular-nums text-sm font-semibold text-[var(--tide-up)]">
                {formatYi(s.d5)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
