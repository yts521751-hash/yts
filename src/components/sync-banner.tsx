"use client";

import { cn } from "@/lib/utils";

export type SyncProgress = { percent: number; label: string } | null;

/**
 * 同步進度條：token 化（原本硬編 #dbe7f5／#1e3a5f，深色模式整塊發亮）。
 * 貼在 header 上方，不再用 fixed 蓋住標題。
 */
export function SyncBanner({
  progress,
  className,
}: {
  progress: SyncProgress;
  className?: string;
}) {
  if (!progress) return null;
  const percent = Math.max(0, Math.min(100, progress.percent || 0));
  const failed = progress.label.includes("失敗");

  return (
    <div
      className={cn("border-b border-line bg-panel", className)}
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto w-full max-w-[1440px] px-4 pt-2 pb-2.5 sm:px-6">
        <div className="flex items-baseline justify-between gap-3">
          <p className="t-label">
            {failed ? "同步失敗" : "正在同步資料"}
            <span className="num ml-1.5 text-muted-foreground">{percent}%</span>
          </p>
          <p className="t-meta min-w-0 truncate text-right">{progress.label}</p>
        </div>
        <div
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunken"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{
              width: `${Math.max(3, percent)}%`,
              background: failed ? "var(--mk-rotate)" : "var(--mk-anchor)",
            }}
          />
        </div>
      </div>
    </div>
  );
}
