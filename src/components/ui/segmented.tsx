"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SegmentedItem<T extends string> = {
  value: T;
  label: ReactNode;
  /** 右側附註（例如數量） */
  hint?: ReactNode;
};

type Size = "sm" | "md";

const SIZE_SHELL: Record<Size, string> = {
  sm: "p-0.5",
  md: "p-0.5",
};

const SIZE_ITEM: Record<Size, string> = {
  // 手機維持 44px 觸控高度，桌面收斂
  sm: "min-h-9 px-2.5 text-xs sm:min-h-8",
  md: "min-h-11 px-3.5 text-[0.8125rem] sm:min-h-9 sm:px-3",
};

function shellClass(size: Size, className?: string) {
  return cn(
    "inline-flex items-center rounded-lg border border-line bg-sunken",
    SIZE_SHELL[size],
    className,
  );
}

function itemClass(size: Size, active: boolean) {
  return cn(
    "inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors",
    SIZE_ITEM[size],
    active
      ? "bg-[var(--mk-anchor)] text-[var(--mk-anchor-fg)] shadow-xs"
      : "text-muted-foreground hover:text-foreground",
  );
}

export function Segmented<T extends string>({
  items,
  value,
  onChange,
  size = "md",
  className,
  ariaLabel,
}: {
  items: ReadonlyArray<SegmentedItem<T>>;
  value: T;
  onChange: (next: T) => void;
  size?: Size;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div className={shellClass(size, className)} role="group" aria-label={ariaLabel}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.value)}
            className={itemClass(size, active)}
          >
            <span>{item.label}</span>
            {item.hint != null ? (
              <span className={cn("num text-[0.75em]", active ? "opacity-80" : "opacity-60")}>
                {item.hint}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function SegmentedLinks({
  items,
  size = "md",
  className,
  ariaLabel,
}: {
  items: ReadonlyArray<{ href: string; label: ReactNode; active: boolean }>;
  size?: Size;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div className={shellClass(size, className)} role="group" aria-label={ariaLabel}>
      {items.map((item) => (
        <Link
          key={item.href + String(item.label)}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={itemClass(size, item.active)}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}
