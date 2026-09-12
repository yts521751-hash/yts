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
    <header className="relative z-20 border-b border-border/60 bg-[var(--panel)]/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="group flex items-center gap-2.5">
            <span className="logo-mark relative flex size-9 items-center justify-center overflow-hidden rounded-sm">
              <span className="absolute inset-0 bg-[var(--mk-anchor)]" />
              <span className="relative font-[family-name:var(--font-display)] text-sm font-bold tracking-widest text-white">
                JM
              </span>
            </span>
            <div className="min-w-0">
              <p className="font-[family-name:var(--font-display)] text-xl font-bold tracking-tight sm:text-2xl">
                金脈
              </p>
              <p className="text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
                JinMai Pulse
              </p>
            </div>
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="hidden items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-1.5 text-xs md:flex">
            <span className="text-muted-foreground">波動</span>
            <span className="font-medium">{fearLabel}</span>
            <span className="tabular-nums text-muted-foreground">{fearScore}</span>
          </div>

          <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-1.5 text-xs">
            <span className="text-muted-foreground">資料日 </span>
            <span className="font-medium tabular-nums">{dateLabel}</span>
            {isDemo && (
              <span className="ml-2 rounded-md bg-[var(--mk-rotate-bg)] px-1.5 py-0.5 text-[10px] text-[var(--mk-rotate)]">
                示範
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 rounded-lg border border-border/50 bg-muted/30 p-1">
            <Type className="ml-1 size-3.5 text-muted-foreground" aria-hidden />
            {(["sm", "md", "lg"] as TextSize[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onTextSize(s)}
                className={cn(
                  "rounded-md px-2 py-1 text-[11px] transition",
                  textSize === s
                    ? "bg-background font-semibold shadow-sm"
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
            className="rounded-lg border border-border/50 bg-muted/30 p-2 text-muted-foreground transition hover:text-foreground"
            aria-label={dark ? "切換淺色" : "切換深色"}
          >
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>

          <div className="hidden items-center gap-2 sm:flex">
            <Link
              href="/wind"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-xs font-medium transition hover:bg-muted/60"
            >
              風度
            </Link>
            <Link
              href="/turnover"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-xs font-medium transition hover:bg-muted/60"
            >
              成交排行
            </Link>
            <Link
              href="/news"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-xs font-medium transition hover:bg-muted/60"
            >
              熱議新聞
            </Link>
          </div>
        </div>
      </div>
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-2 px-4 pb-2 text-[11px] text-muted-foreground sm:px-6">
        <p>更新於 {updatedAt}</p>
        <p>資料來源：臺灣證券交易所、證券櫃檯買賣中心公開資料</p>
      </div>
    </header>
  );
}
