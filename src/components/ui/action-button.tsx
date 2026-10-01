"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type Variant = "outline" | "solid" | "ghost";
type Size = "sm" | "md";

const VARIANT: Record<Variant, string> = {
  outline:
    "border border-line bg-panel text-foreground hover:border-line-strong hover:bg-sunken",
  solid:
    "border border-transparent bg-[var(--mk-anchor)] text-[var(--mk-anchor-fg)] hover:brightness-110",
  ghost: "border border-transparent text-muted-foreground hover:bg-sunken hover:text-foreground",
};

const SIZE: Record<Size, string> = {
  sm: "min-h-9 gap-1.5 px-2.5 text-xs",
  md: "min-h-11 gap-2 px-3.5 text-[0.8125rem] sm:min-h-10",
};

export function ActionButton({
  children,
  className,
  variant = "outline",
  size = "md",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
}) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center justify-center rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function IconButton({
  children,
  className,
  variant = "outline",
  label,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: Variant;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-10 items-center justify-center rounded-lg transition-colors disabled:opacity-50 sm:size-9",
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
