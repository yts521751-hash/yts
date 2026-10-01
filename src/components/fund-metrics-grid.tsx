import { cn } from "@/lib/utils";
import { Stat } from "@/components/ui/stat";

export type FundMetricsProps = {
  forwardPe?: number | null;
  nextYearEps?: number | null;
  baseEps?: number | null;
  epsYoy?: number | null;
  /** 本益成長比；未傳時由前瞻 PE ÷ EPS YoY% 推算 */
  peg?: number | null;
  className?: string;
  /** 呼叫端已把 EPS YoY 當標頭數字時，避免同卡重複 */
  omitYoy?: boolean;
};

/** PEG = 前瞻本益比 ÷ 明年 EPS YoY（%）；成長≤0 或缺值 → null */
export function pegFromPeAndYoy(
  forwardPe: number | null | undefined,
  epsYoy: number | null | undefined,
): number | null {
  if (
    forwardPe == null ||
    epsYoy == null ||
    !(forwardPe > 0) ||
    !(epsYoy > 0) ||
    !Number.isFinite(forwardPe) ||
    !Number.isFinite(epsYoy)
  ) {
    return null;
  }
  return Math.round((forwardPe / epsYoy) * 100) / 100;
}

function fmtPeg(peg: number | null | undefined) {
  if (peg == null || !Number.isFinite(peg)) return "—";
  return peg.toFixed(2);
}

/** 與價值選股相同口徑的指標格（成交排行展開、單股查詢共用） */
export function FundMetricsGrid({
  forwardPe,
  nextYearEps,
  baseEps,
  epsYoy,
  peg,
  className,
  omitYoy = false,
}: FundMetricsProps) {
  const resolvedPeg =
    peg !== undefined ? peg : pegFromPeAndYoy(forwardPe, epsYoy);

  return (
    <div
      className={cn(
        "grid gap-2",
        omitYoy
          ? "grid-cols-2 sm:grid-cols-3"
          : "grid-cols-2 md:grid-cols-4",
        className,
      )}
    >
      <Stat
        size="sm"
        label="前瞻本益比"
        value={
          forwardPe != null && Number.isFinite(forwardPe)
            ? forwardPe.toFixed(1)
            : "—"
        }
      />
      <Stat size="sm" label="本益成長比" value={fmtPeg(resolvedPeg)} />
      <Stat
        size="sm"
        label="明年／今年 EPS"
        value={`${nextYearEps != null ? nextYearEps.toFixed(2) : "—"} / ${
          baseEps != null ? baseEps.toFixed(2) : "—"
        }`}
      />
      {omitYoy ? null : (
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
      )}
    </div>
  );
}
