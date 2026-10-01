"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Inbox, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden />;
}

export function SkeletonRows({
  rows = 6,
  className,
  height = "h-16",
}: {
  rows?: number;
  className?: string;
  height?: string;
}) {
  return (
    <div className={cn("space-y-2", className)} aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={height} />
      ))}
    </div>
  );
}

export function LoadingState({
  label = "載入中…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-14 text-center",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
      <p className="t-meta">{label}</p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  className,
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-14 text-center",
        className,
      )}
    >
      <span className="surface-sunken mb-1 flex size-10 items-center justify-center text-muted-foreground">
        {icon ?? <Inbox className="size-4" aria-hidden />}
      </span>
      <p className="t-label">{title}</p>
      {description ? (
        <p className="t-meta max-w-prose leading-relaxed">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "無法載入資料",
  description,
  action,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-12 text-center",
        className,
      )}
      role="alert"
    >
      <span
        className="mb-1 flex size-10 items-center justify-center rounded-md"
        style={{
          color: "var(--mk-rotate)",
          background: "var(--mk-rotate-bg)",
        }}
      >
        <AlertTriangle className="size-4" aria-hidden />
      </span>
      <p className="t-label">{title}</p>
      {description ? (
        <p className="t-meta max-w-prose leading-relaxed">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** 提醒條（示範資料／快取／背景同步等） */
export function NoticeBar({
  children,
  tone = "info",
  className,
}: {
  children: ReactNode;
  tone?: "info" | "warn";
  className?: string;
}) {
  return (
    <p
      className={cn(
        "rounded-lg border px-3 py-2 text-xs leading-relaxed",
        tone === "warn"
          ? "border-[var(--mk-rotate)]/35 bg-[var(--mk-rotate-bg)] text-[var(--mk-rotate)]"
          : "border-line bg-sunken text-muted-foreground",
        className,
      )}
    >
      {children}
    </p>
  );
}
