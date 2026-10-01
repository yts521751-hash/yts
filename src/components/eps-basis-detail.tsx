"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type {
  BrokerEpsEstimate,
  EpsConsensusBasis,
} from "@/lib/fundamentals";
import { cn } from "@/lib/utils";

export type EpsBasisProps = {
  brokers?: BrokerEpsEstimate[] | null;
  consensusBasis?: EpsConsensusBasis | null;
  epsSource?: string | null;
  className?: string;
  /** 預設摺疊 */
  defaultOpen?: boolean;
};

function fmtEps(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

/** 明年 EPS 依據：逐家券商列，或共識統計降級顯示 */
export function EpsBasisDetail({
  brokers,
  consensusBasis,
  epsSource,
  className,
  defaultOpen = false,
}: EpsBasisProps) {
  const [open, setOpen] = useState(defaultOpen);
  const rows = brokers?.length ? brokers : [];
  const hasConsensus =
    consensusBasis &&
    (consensusBasis.median != null ||
      consensusBasis.mean != null ||
      consensusBasis.numEst != null);
  const hasAny = rows.length > 0 || hasConsensus;

  if (!hasAny) {
    return (
      <p className={cn("text-[11px] text-muted-foreground", className)}>
        尚無明年 EPS 依據明細
        {epsSource ? `（來源 ${epsSource}）` : ""}
      </p>
    );
  }

  const onlyConsensus =
    rows.length > 0 && rows.every((r) => r.kind === "consensus");

  return (
    <div className={cn("text-[11px]", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex w-full items-center justify-between gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5 text-left transition hover:bg-muted/60"
        aria-expanded={open}
      >
        <span className="font-medium text-foreground/90">
          明年 EPS 依據
          {consensusBasis?.numEst != null
            ? ` · ${consensusBasis.numEst} 家`
            : rows.length
              ? ` · ${rows.length} 列`
              : ""}
          {onlyConsensus ? "（共識統計）" : ""}
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          {hasConsensus ? (
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              <div className="rounded-md bg-muted/30 px-2 py-1">
                <div className="text-muted-foreground">中位數</div>
                <div className="font-semibold tabular-nums">
                  {fmtEps(consensusBasis!.median)}
                </div>
              </div>
              <div className="rounded-md bg-muted/30 px-2 py-1">
                <div className="text-muted-foreground">平均</div>
                <div className="font-semibold tabular-nums">
                  {fmtEps(consensusBasis!.mean)}
                </div>
              </div>
              <div className="rounded-md bg-muted/30 px-2 py-1">
                <div className="text-muted-foreground">最高／最低</div>
                <div className="font-semibold tabular-nums">
                  {fmtEps(consensusBasis!.high)} / {fmtEps(consensusBasis!.low)}
                </div>
              </div>
              <div className="rounded-md bg-muted/30 px-2 py-1">
                <div className="text-muted-foreground">年度／日期</div>
                <div className="font-semibold tabular-nums">
                  {consensusBasis!.targetYear ?? "—"}
                  {consensusBasis!.rateDate
                    ? ` · ${consensusBasis!.rateDate}`
                    : ""}
                </div>
              </div>
            </div>
          ) : null}

          {rows.length ? (
            <ul className="divide-y divide-border/40 overflow-hidden rounded-lg border border-border/40">
              {rows.map((r, i) => (
                <li
                  key={`${r.broker}-${i}`}
                  className="flex items-baseline justify-between gap-3 px-2.5 py-1.5"
                >
                  <span className="min-w-0 truncate text-muted-foreground">
                    {r.broker}
                    {r.asOf ? (
                      <span className="ml-1 text-[10px] opacity-70">
                        {r.asOf}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {fmtEps(r.eps)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {onlyConsensus || (!rows.length && hasConsensus) ? (
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              目前公開來源僅提供法人共識彙總（中位數／平均／高低與家數），尚未取得逐家券商名稱列；有逐家資料時會自動列出。
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export type FundMetricsProps = {
  forwardPe?: number | null;
  nextYearEps?: number | null;
  baseEps?: number | null;
  epsYoy?: number | null;
  className?: string;
};

/** 與價值選股相同口徑的三欄指標 */
export function FundMetricsGrid({
  forwardPe,
  nextYearEps,
  baseEps,
  epsYoy,
  className,
}: FundMetricsProps) {
  return (
    <div className={cn("grid grid-cols-3 gap-2 text-[11px]", className)}>
      <div className="rounded-lg bg-muted/40 px-2 py-1.5">
        <div className="text-muted-foreground">前瞻本益比</div>
        <div className="mt-0.5 font-semibold tabular-nums">
          {forwardPe != null && Number.isFinite(forwardPe)
            ? forwardPe.toFixed(1)
            : "—"}
        </div>
      </div>
      <div className="rounded-lg bg-muted/40 px-2 py-1.5">
        <div className="text-muted-foreground">明年／今年 EPS</div>
        <div className="mt-0.5 font-semibold tabular-nums">
          {nextYearEps != null ? nextYearEps.toFixed(2) : "—"}
          {" / "}
          {baseEps != null ? baseEps.toFixed(2) : "—"}
        </div>
      </div>
      <div className="rounded-lg bg-muted/40 px-2 py-1.5">
        <div className="text-muted-foreground">EPS YoY</div>
        <div
          className={cn(
            "mt-0.5 font-semibold tabular-nums",
            epsYoy != null && epsYoy > 0 && "text-[var(--mk-up)]",
          )}
        >
          {epsYoy != null
            ? `${epsYoy > 0 ? "+" : ""}${epsYoy.toFixed(1)}%`
            : "—"}
        </div>
      </div>
    </div>
  );
}
