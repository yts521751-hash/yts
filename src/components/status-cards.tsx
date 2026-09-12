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
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
      {ORDER.map((key, i) => {
        const meta = STATUS_META[key];
        const selected = active === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(selected ? "all" : key)}
            className={cn(
              "status-card group relative overflow-hidden rounded-md border px-3 py-3 text-left transition-all duration-300",
              "hover:translate-x-0.5",
              selected
                ? "border-transparent shadow-sm ring-2 ring-[color:var(--ring-color)]"
                : "border-border/60 bg-[var(--panel)]/80 hover:border-border",
            )}
            style={
              {
                "--ring-color": meta.color,
                animationDelay: `${i * 70}ms`,
                background: selected ? meta.bg : undefined,
              } as React.CSSProperties
            }
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">{meta.short}</span>
              <span
                className="size-2 rounded-full"
                style={{ background: meta.color }}
                aria-hidden
              />
            </div>
            <p className="mt-1 font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight tabular-nums md:text-3xl">
              {counts[key]}
            </p>
            <p className="mt-0.5 text-sm font-semibold" style={{ color: meta.color }}>
              {meta.label}
            </p>
          </button>
        );
      })}
    </div>
  );
}
