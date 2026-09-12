"use client";

import { useMemo, useState } from "react";
import type { StockFlow } from "@/lib/types";
import {
  formatHeat,
  formatPct,
  formatYi,
  formatYiSigned,
  signedClass,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

export type StockRankPeriod = "day" | "d5";

type SortKey = "amt" | "flow" | "accel" | "heat" | "changePct";

export type StockFlowRankRow = StockFlow & {
  accel?: number;
  heat?: number;
};

type Props = {
  rows: StockFlowRankRow[];
  limit?: number;
};

function periodAmt(s: StockFlowRankRow, period: StockRankPeriod): number {
  return period === "day" ? s.dayAmt : s.d5;
}

function periodFlow(s: StockFlowRankRow, period: StockRankPeriod): number {
  return period === "day" ? s.dayFlow : s.d5Flow;
}

function sortValue(
  s: StockFlowRankRow,
  key: SortKey,
  period: StockRankPeriod,
): number {
  if (key === "amt") return periodAmt(s, period);
  if (key === "flow") return periodFlow(s, period);
  if (key === "accel") return s.accel ?? 0;
  if (key === "heat") return s.heat ?? 0;
  return s.changePct;
}

const RANK_LIMIT = 20;

export function StockRanking({ rows, limit = RANK_LIMIT }: Props) {
  const [period, setPeriod] = useState<StockRankPeriod>("day");
  const [sortKey, setSortKey] = useState<SortKey>("amt");
  const [asc, setAsc] = useState(false);

  const columns = useMemo(
    () => [
      {
        key: "amt" as const,
        label: period === "day" ? "成交額" : "5 日成交",
      },
      {
        key: "flow" as const,
        label: period === "day" ? "當日淨流" : "近 5 日流",
      },
      { key: "accel" as const, label: "加速度", hideSm: true },
      { key: "heat" as const, label: "量能", hideSm: true },
      { key: "changePct" as const, label: "漲跌" },
    ],
    [period],
  );

  const ranked = useMemo(() => {
    const sorted = [...rows].sort((a, b) => {
      const primary = sortValue(a, sortKey, period) - sortValue(b, sortKey, period);
      if (primary !== 0) return asc ? primary : -primary;
      if (sortKey === "flow") {
        const byAmt = periodAmt(a, period) - periodAmt(b, period);
        return asc ? byAmt : -byAmt;
      }
      const secondary = periodFlow(a, period) - periodFlow(b, period);
      return asc ? secondary : -secondary;
    });
    return sorted.slice(0, limit);
  }, [rows, sortKey, asc, period, limit]);

  const onSort = (key: SortKey) => {
    if (sortKey === key) setAsc((v) => !v);
    else {
      setSortKey(key);
      setAsc(false);
    }
  };

  return (
    <div className="flex h-full min-h-[320px] flex-col sm:min-h-[480px]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 px-2 pb-2 sm:px-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex border border-border bg-muted/30 p-0.5">
            {(
              [
                ["day", "當日"],
                ["d5", "5 日"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setPeriod(key);
                  setSortKey("amt");
                  setAsc(false);
                }}
                className={cn(
                  "px-2.5 py-1 text-xs transition",
                  period === key
                    ? "bg-[var(--mk-anchor)] font-semibold text-white"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">個股金流</p>
        </div>
        <p className="text-[11px] tabular-nums text-muted-foreground">
          顯示前 {ranked.length}（上限 {limit}）／共 {rows.length} 檔 ·
          預設成交額→淨流
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-1 md:hidden">
        {ranked.map((s, i) => {
          const amt = periodAmt(s, period);
          const flow = periodFlow(s, period);
          return (
            <div
              key={s.code}
              className="flex w-full items-center gap-3 border border-border/50 bg-[var(--panel)] px-3 py-2.5 text-left"
            >
              <span className="w-6 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{s.name}</p>
                <p className="text-[11px] tabular-nums text-muted-foreground">
                  {s.code}
                </p>
              </div>
              <div className="text-right text-xs">
                <p className="tabular-nums">{formatYi(amt)}</p>
                <p className={cn("font-medium tabular-nums", signedClass(flow))}>
                  {formatYiSigned(flow)}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="hidden min-h-0 flex-1 overflow-auto md:block">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--panel)]">
            <tr className="text-left text-[11px] text-muted-foreground">
              <th className="w-10 px-2 py-2.5 font-medium sm:px-3">#</th>
              <th className="px-2 py-2.5 font-medium sm:px-3">個股</th>
              {columns.map((col) => {
                const active = sortKey === col.key;
                return (
                  <th
                    key={col.key}
                    className={cn(
                      "px-2 py-2.5 font-medium sm:px-3",
                      "hideSm" in col && col.hideSm && "hidden lg:table-cell",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSort(col.key)}
                      className={cn(
                        "inline-flex items-center gap-1 transition hover:text-foreground",
                        active && "text-foreground",
                      )}
                    >
                      {col.label}
                      {active ? (
                        asc ? (
                          <ArrowUp className="size-3.5" />
                        ) : (
                          <ArrowDown className="size-3.5" />
                        )
                      ) : (
                        <ArrowUpDown className="size-3.5 opacity-40" />
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {ranked.map((s, i) => {
              const amt = periodAmt(s, period);
              const flow = periodFlow(s, period);
              return (
                <tr
                  key={s.code}
                  className="rank-row-enter border-t border-border/40 transition hover:bg-muted/30"
                  style={{ animationDelay: `${Math.min(i, 12) * 20}ms` }}
                >
                  <td className="px-2 py-2.5 tabular-nums text-muted-foreground sm:px-3">
                    {i + 1}
                  </td>
                  <td className="px-2 py-2.5 sm:px-3">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-[11px] tabular-nums text-muted-foreground">
                      {s.code}
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums sm:px-3">
                    {formatYi(amt)}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-2.5 text-right font-semibold tabular-nums sm:px-3",
                      signedClass(flow),
                    )}
                  >
                    {formatYiSigned(flow)}
                  </td>
                  <td
                    className={cn(
                      "hidden px-2 py-2.5 text-right tabular-nums lg:table-cell sm:px-3",
                      signedClass(s.accel ?? 0),
                    )}
                  >
                    {formatYiSigned(s.accel ?? 0)}
                  </td>
                  <td className="hidden px-2 py-2.5 text-right tabular-nums lg:table-cell sm:px-3">
                    {formatHeat(s.heat ?? 1)}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-2.5 text-right tabular-nums sm:px-3",
                      signedClass(s.changePct),
                    )}
                  >
                    {formatPct(s.changePct)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
