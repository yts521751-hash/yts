"use client";

import type { SectorFlow } from "@/lib/types";
import { STATUS_META } from "@/lib/types";
import { cpScore } from "@/lib/mock-data";
import { formatHeat, formatPct, formatYi } from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = {
  items: SectorFlow[];
  onSelect: (s: SectorFlow) => void;
  selectedId?: string | null;
};

export function CpRanking({ items, onSelect, selectedId }: Props) {
  return (
    <div className="space-y-2">
      <p className="text-xs leading-relaxed text-muted-foreground">
        CP 值＝近 20 日成交金額大、但股價漲幅仍相對溫和。解讀成「換手熱絡、價格尚未完全反應」的觀察清單，不是保證上漲。
      </p>
      <ol className="space-y-2">
        {items.map((s, i) => {
          const meta = STATUS_META[s.status];
          const score = cpScore(s);
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                  selectedId === s.id
                    ? "border-transparent bg-[var(--tide-surge-bg)] ring-1 ring-[var(--tide-surge)]"
                    : "border-border/50 bg-[var(--panel)]/60 hover:bg-muted/50",
                )}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted font-[family-name:var(--font-display)] text-sm font-semibold tabular-nums">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{s.name}</span>
                    <span className="text-[11px]" style={{ color: meta.color }}>{meta.label}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                    <span>20 日成交 {formatYi(s.d20)}</span>
                    <span>熱度 {formatHeat(s.heat)}</span>
                    <span>漲幅 {formatPct(s.priceChange20d)}</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-muted-foreground">CP</p>
                  <p className="font-semibold tabular-nums text-[var(--tide-surge)]">{score.toFixed(0)}</p>
                </div>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
