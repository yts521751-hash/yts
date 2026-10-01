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

/** 明年 EPS 依據：共識統計（成交值等次要展開可复用；價值選股改用券商目標價） */
export function EpsBasisDetail({
  brokers,
  consensusBasis,
  epsSource,
  className,
  defaultOpen = false,
}: EpsBasisProps) {
  const [open, setOpen] = useState(defaultOpen);
  // 過濾掉純 FactSet／Yahoo 共識列，避免再當「逐家券商」展示
  const rows = (brokers ?? []).filter((r) => r.kind !== "consensus");
  const hasConsensus =
    consensusBasis &&
    (consensusBasis.median != null ||
      consensusBasis.mean != null ||
      consensusBasis.numEst != null);
  const hasAny = rows.length > 0 || hasConsensus;

  if (!hasAny) {
    return (
      <p className={cn("text-[11px] text-muted-foreground", className)}>
        尚無 EPS 共識明細
        {epsSource ? `（來源 ${epsSource}）` : ""}
      </p>
    );
  }

  return (
    <div className={cn("text-[11px]", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex w-full items-center justify-between gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5 text-left transition hover:bg-muted/60"
        aria-expanded={open}
      >
        <span className="font-medium text-foreground/90">
          EPS 共識摘要
          {consensusBasis?.numEst != null
            ? ` · ${consensusBasis.numEst} 家`
            : rows.length
              ? ` · ${rows.length} 列`
              : ""}
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

          <p className="text-[10px] leading-relaxed text-muted-foreground">
            此為法人 EPS 共識彙總。價值選股的「依據」改列逐家券商目標價。
          </p>
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
