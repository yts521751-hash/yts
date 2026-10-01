"use client";

import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** 類別標（產業／題材／新興）等中性標籤 */
export function Chip({
  children,
  className,
  tone = "neutral",
}: {
  children: ReactNode;
  className?: string;
  tone?: "neutral" | "outline";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[0.6875rem] leading-tight",
        tone === "outline"
          ? "border border-line text-muted-foreground"
          : "bg-sunken text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** 四態／流入流出等語意標籤：色票由 token 帶入 */
export function StatusPill({
  label,
  color,
  background,
  className,
  note,
}: {
  label: ReactNode;
  color: string;
  background: string;
  className?: string;
  note?: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold leading-tight",
        className,
      )}
      style={{ color, background }}
    >
      {label}
      {note ? <span className="font-normal opacity-80">{note}</span> : null}
    </span>
  );
}

export type SortState = "none" | "asc" | "desc";

function SortGlyph({ state, className }: { state: SortState; className?: string }) {
  if (state === "asc") return <ArrowUp className={cn("size-3.5", className)} />;
  if (state === "desc") return <ArrowDown className={cn("size-3.5", className)} />;
  return <ArrowUpDown className={cn("size-3 opacity-40", className)} />;
}

/** 手機排序 chip（可橫向捲） */
export function SortChip({
  label,
  state,
  onClick,
  className,
}: {
  label: ReactNode;
  state: SortState;
  onClick: () => void;
  className?: string;
}) {
  const active = state !== "none";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors",
        active
          ? "border-[var(--mk-anchor)] bg-[var(--mk-anchor-bg)] font-semibold text-foreground"
          : "border-line bg-panel text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      <span>{label}</span>
      <SortGlyph state={state} />
    </button>
  );
}

/** 桌面表頭排序鈕 */
export function SortHeaderButton({
  children,
  state,
  onClick,
  align = "right",
  className,
}: {
  children: ReactNode;
  state: SortState;
  onClick: () => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = state !== "none";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex w-full items-center gap-1 whitespace-nowrap rounded-sm transition-colors hover:text-foreground",
        align === "right" ? "justify-end" : "justify-start",
        active && "text-foreground",
        className,
      )}
    >
      {children}
      <SortGlyph state={state} />
    </button>
  );
}

/** 固定寬名次槽，讓所有排行列左緣對齊 */
export function RankSlot({
  rank,
  className,
  emphasis = false,
}: {
  rank: number;
  className?: string;
  emphasis?: boolean;
}) {
  return (
    <span
      className={cn(
        "num inline-flex w-6 shrink-0 justify-end text-xs text-muted-foreground",
        emphasis && rank <= 3 && "font-semibold text-foreground",
        className,
      )}
    >
      {rank}
    </span>
  );
}
