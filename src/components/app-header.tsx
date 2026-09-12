"use client";

import Link from "next/link";
import { Moon, Sun, Type } from "lucide-react";
import { cn } from "@/lib/utils";

type TextSize = "sm" | "md" | "lg";

type Props = {
  dateLabel: string;
  updatedAt: string;
  isDemo: boolean;
  fearLabel: string;
  fearScore: number;
  textSize: TextSize;
  onTextSize: (s: TextSize) => void;
  dark: boolean;
  onToggleDark: () => void;
};

export function AppHeader({
  dateLabel,
  updatedAt,
  isDemo,
  fearLabel,
  fearScore,
  textSize,
  onTextSize,
  dark,
  onToggleDark,
}: Props) {
  return (
    <header className="relative z-20 border-b-2 border-[var(--mk-anchor)]/30 bg-[var(--panel)]">
      <div className="h-1 w-full bg-[var(--mk-anchor)]" />
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="group flex items-center gap-2.5">
            <span className="logo-mark relative flex size-9 items-center justify-center overflow-hidden">
              <span className="absolute inset-0 bg-[var(--mk-anchor)]" />
              <span className="relative font-[family-name:var(--font-display)] text-xs font-bold tracking-[0.2em] text-white">
                流
              </span>
            </span>
            <div className="min-w-0">
              <p className="font-[family-name:var(--font-display)] text-xl font-bold tracking-tight sm:text-2xl">
                金流看板
              </p>
              <p className="font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase">
                Cashflow Board
              </p>
            </div>
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="hidden items-center gap-2 border border-border bg-muted/40 px-3 py-1.5 font-mono text-xs md:flex">
            <span className="text-muted-foreground">VOL</span>
            <span className="font-medium">{fearLabel}</span>
            <span className="tabular-nums text-muted-foreground">{fearScore}</span>
          </div>

          <div className="border border-border bg-muted/40 px-3 py-1.5 font-mono text-xs">
            <span className="text-muted-foreground">DATE </span>
            <span className="font-medium tabular-nums">{dateLabel}</span>
            {isDemo && (
              <span className="ml-2 bg-[var(--mk-rotate-bg)] px-1.5 py-0.5 text-[10px] text-[var(--mk-rotate)]">
                DEMO
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 border border-border bg-muted/40 p-1">
            <Type className="ml-1 size-3.5 text-muted-foreground" aria-hidden />
            {(["sm", "md", "lg"] as TextSize[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onTextSize(s)}
                className={cn(
                  "px-2 py-1 text-[11px] transition",
                  textSize === s
                    ? "bg-[var(--mk-anchor)] font-semibold text-white"
                    : "text-muted-foreground hover:text-foreground",
                )}
                aria-label={`字級 ${s}`}
              >
                {s === "sm" ? "小" : s === "md" ? "中" : "大"}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onToggleDark}
            className="border border-border bg-muted/40 p-2 text-muted-foreground transition hover:text-foreground"
            aria-label={dark ? "切換淺色" : "切換深色"}
          >
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>

          <div className="hidden items-center gap-2 sm:flex">
            {(
              [
                ["/wind", "風度"],
                ["/turnover", "成交排行"],
                ["/news", "熱議新聞"],
              ] as const
            ).map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className="inline-flex items-center border border-border bg-muted/40 px-3 py-2 text-xs font-medium transition hover:border-[var(--mk-anchor)] hover:text-[var(--mk-anchor)]"
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
      </div>
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-2 border-t border-border/50 px-4 py-1.5 font-mono text-[11px] text-muted-foreground sm:px-6">
        <p>UPDATED {updatedAt}</p>
        <p>TWSE · TPEx PUBLIC DATA</p>
      </div>
    </header>
  );
}
