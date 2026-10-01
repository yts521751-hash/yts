import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { signedClass } from "@/lib/format";

/** 指標格：取代各處手寫的 bg-muted/40 px-2 py-1.5 */
export function Stat({
  label,
  value,
  tone,
  hint,
  className,
  size = "md",
}: {
  label: ReactNode;
  value: ReactNode;
  /** 傳入數值即套用漲跌色 */
  tone?: number;
  hint?: ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <div className={cn("surface-sunken px-2.5 py-2", className)}>
      <p className="text-[0.6875rem] leading-tight text-muted-foreground">{label}</p>
      <p
        className={cn(
          "num mt-1 font-semibold leading-tight",
          size === "sm" ? "text-[0.8125rem]" : size === "lg" ? "text-lg" : "text-sm",
          tone !== undefined ? signedClass(tone) : undefined,
        )}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 text-[0.6875rem] leading-tight text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function StatGrid({
  children,
  className,
  cols = 3,
}: {
  children: ReactNode;
  className?: string;
  cols?: 2 | 3 | 4;
}) {
  return (
    <div
      className={cn(
        "grid gap-2",
        cols === 2
          ? "grid-cols-2"
          : cols === 4
            ? "grid-cols-2 sm:grid-cols-4"
            : "grid-cols-3",
        className,
      )}
    >
      {children}
    </div>
  );
}
