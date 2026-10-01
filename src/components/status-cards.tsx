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
  const filtering = active !== "all";

  return (
    <section aria-label="四態篩選">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="t-eyebrow">FLOW STATES · 近 5 日淨流 × 加速度</p>
        {filtering ? (
          <button
            type="button"
            onClick={() => onChange("all")}
            className="t-meta inline-flex min-h-8 items-center rounded-md px-1.5 font-medium text-[var(--mk-anchor)] transition-colors hover:underline"
          >
            清除篩選
          </button>
        ) : (
          <p className="t-meta">點卡片可只看該狀態</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line shadow-xs md:grid-cols-4">
        {ORDER.map((key, i) => {
          const meta = STATUS_META[key];
          const selected = active === key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(selected ? "all" : key)}
              title={meta.hint}
              className={cn(
                "status-card group relative overflow-hidden px-3 py-3 text-left transition-colors sm:px-4 sm:py-3.5",
                selected ? "bg-panel" : "bg-panel hover:bg-sunken",
              )}
              style={
                {
                  animationDelay: `${i * 55}ms`,
                  background: selected ? meta.bg : undefined,
                } as React.CSSProperties
              }
            >
              <span
                className="absolute inset-y-0 left-0 w-[3px]"
                style={{ background: meta.color }}
                aria-hidden
              />
              <span className="flex items-center justify-between gap-2">
                <span className="t-eyebrow">{meta.short}</span>
                {selected ? (
                  <span
                    className="rounded-full px-1.5 py-px text-[0.625rem] font-semibold"
                    style={{ color: meta.color, background: "var(--panel)" }}
                  >
                    篩選中
                  </span>
                ) : null}
              </span>
              <span className="mt-1.5 flex items-baseline gap-2">
                <span className="t-display num text-[1.75rem] leading-none sm:text-[2rem]">
                  {counts[key]}
                </span>
                <span
                  className="text-[0.8125rem] font-semibold"
                  style={{ color: meta.color }}
                >
                  {meta.label}
                </span>
              </span>
              <span className="mt-1.5 hidden text-[0.6875rem] leading-snug text-muted-foreground md:block">
                {meta.hint}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
