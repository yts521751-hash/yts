import { cn } from "@/lib/utils";
import { Stat } from "@/components/ui/stat";

export type FundMetricsProps = {
  forwardPe?: number | null;
  nextYearEps?: number | null;
  baseEps?: number | null;
  epsYoy?: number | null;
  className?: string;
};

/** 與價值選股相同口徑的三欄指標（成交排行展開、單股查詢共用） */
export function FundMetricsGrid({
  forwardPe,
  nextYearEps,
  baseEps,
  epsYoy,
  className,
}: FundMetricsProps) {
  return (
    <div className={cn("grid grid-cols-3 gap-2", className)}>
      <Stat
        size="sm"
        label="前瞻本益比"
        value={
          forwardPe != null && Number.isFinite(forwardPe)
            ? forwardPe.toFixed(1)
            : "—"
        }
      />
      <Stat
        size="sm"
        label="明年／今年 EPS"
        value={`${nextYearEps != null ? nextYearEps.toFixed(2) : "—"} / ${
          baseEps != null ? baseEps.toFixed(2) : "—"
        }`}
      />
      <Stat
        size="sm"
        label="EPS YoY"
        tone={epsYoy ?? undefined}
        value={
          epsYoy != null
            ? `${epsYoy > 0 ? "+" : ""}${epsYoy.toFixed(1)}%`
            : "—"
        }
      />
    </div>
  );
}
