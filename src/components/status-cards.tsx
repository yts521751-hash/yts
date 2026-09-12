"use client";

import type { TideStatus } from "@/lib/types";
import { STATUS_META } from "@/lib/types";
import { cn } from "@/lib/utils";

type Counts = Record<TideStatus, number>;

type Props = {
  counts: Counts;
  active: TideStatus | "all";
  onChange: (v: TideStatus | "all") => void;
};

const ORDER: TideStatus[] = ["surge", "rotate", "watch", "ebb"];

export function StatusCards({ counts, active, onChange }: Props) {
  return (
    <div className="grid grid-cols-2 gap-px md:grid-cols-4 bg-border/70 border border-border/70">
      {ORDER.map((key, i) => {
        const meta = STATUS_META[key];
        const selected = active === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(selected ? "all" : key)}
            className={cn(
              "status-card group relative px-3 py-3 text-left transition-colors",
              selected
                ? "bg-[var(--panel)]"
                : "bg-[var(--panel)]/90 hover:bg-[var(--panel)]",
            )}
            style={
              {
                borderLeftColor: meta.color,
                animationDelay: `${i * 60}ms`,
                boxShadow: selected
                  ? `inset 0 0 0 1px ${meta.color}`
                  : undefined,
                background: selected ? meta.bg : undefined,
              } as React.CSSProperties
            }
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                {meta.short}
              </span>
              <span
                className="h-3 w-0.5"
                style={{ background: meta.color }}
                aria-hidden
              />
            </div>
            <p className="mt-2 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight tabular-nums">
              {counts[key]}
            </p>
            <p className="mt-1 text-sm font-semibold" style={{ color: meta.color }}>
              {meta.label}
            </p>
          </button>
        );
      })}
    </div>
  );
}
