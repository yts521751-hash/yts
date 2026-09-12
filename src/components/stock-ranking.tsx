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
import { COLUMN_TIPS, ColumnTip } from "@/components/column-tip";

export type StockRankPeriod = "day" | "d3" | "d5";

type SortKey = "changePct" | "amt" | "flow" | "accel" | "heat";

export type StockFlowRankRow = StockFlow & {
  accel?: number;
  heat?: number;
  close?: number;
};

type Props = {
  rows: StockFlowRankRow[];
  limit?: number;
};

type ColDef = {
  key: SortKey;
  label: string;
  tip: string;
  hideLg?: boolean;
};

function periodAmt(s: StockFlowRankRow, period: StockRankPeriod): number {
  if (period === "d3") return s.d3;
  if (period === "d5") return s.d5;
  return s.dayAmt;
}

function periodFlow(s: StockFlowRankRow, period: StockRankPeriod): number {
  if (period === "d3") return s.d3Flow;
  if (period === "d5") return s.d5Flow;
  return s.dayFlow;
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

  const columns = useMemo<ColDef[]>(
    () => [
      {
        key: "changePct",
        label: "漲跌",
        tip: COLUMN_TIPS.changePct,
      },
      {
        key: "amt",
        label:
          period === "day" ? "成交額" : period === "d3" ? "3 日成交" : "5 日成交",
        tip:
          period === "day"
            ? COLUMN_TIPS.amt
            : period === "d3"
              ? COLUMN_TIPS.amt3
              : COLUMN_TIPS.amt5,
      },
      {
        key: "flow",
        label:
          period === "day"
            ? "當日淨流"
            : period === "d3"
              ? "近 3 日流"
              : "近 5 日流",
        tip:
          period === "day"
            ? COLUMN_TIPS.flow
            : period === "d3"
              ? COLUMN_TIPS.flow3
              : COLUMN_TIPS.flow5,
      },
      {
        key: "accel",
        label: "加速度",
        tip: COLUMN_TIPS.accel,
        hideLg: true,
      },
      {
        key: "heat",
        label: "量能",
        tip: COLUMN_TIPS.heat,
        hideLg: true,
      },
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

  const renderSortIcon = (key: SortKey) => {
    if (sortKey !== key) {
      return <ArrowUpDown className="size-3.5 opacity-40" />;
    }
    return asc ? (
      <ArrowUp className="size-3.5" />
    ) : (
      <ArrowDown className="size-3.5" />
    );
  };

  return (
    <div className="flex h-full min-h-[320px] flex-col sm:min-h-[480px]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 px-2 pb-2 sm:px-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex border border-border bg-muted/30 p-0.5">
            {(
              [
                ["day", "當日"],
                ["d3", "3 日"],
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
                  {s.close != null && s.close > 0
                    ? ` · ${s.close.toLocaleString("zh-TW")}`
                    : ""}
                  <span className={cn("ml-2", signedClass(s.changePct))}>
                    {formatPct(s.changePct)}
                  </span>
                </p>
              </div>
              <div className="shrink-0 text-right text-xs">
                <p className="whitespace-nowrap tabular-nums">{formatYi(amt)}</p>
                <p
                  className={cn(
                    "whitespace-nowrap font-medium tabular-nums",
                    signedClass(flow),
                  )}
                >
                  {formatYiSigned(flow)}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="hidden min-h-0 flex-1 overflow-x-auto md:block">
        <table className="w-full min-w-[640px] table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-10" />
            <col className="w-[28%]" />
            <col className="w-[12%]" />
            <col className="w-[14%]" />
            <col className="w-[14%]" />
            <col className="w-[14%]" />
            <col className="w-[12%]" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-[var(--panel)]">
            <tr className="text-[11px] text-muted-foreground">
              <th className="px-2 py-2.5 text-left font-medium sm:px-3">#</th>
              <th className="px-2 py-2.5 text-left font-medium sm:px-3">個股</th>
              {columns.map((col) => {
                const active = sortKey === col.key;
                return (
                  <th
                    key={col.key}
                    className={cn(
                      "px-2 py-2.5 text-right font-medium sm:px-3",
                      col.hideLg && "hidden lg:table-cell",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSort(col.key)}
                      className={cn(
                        "inline-flex w-full items-center justify-end gap-1 whitespace-nowrap transition hover:text-foreground",
                        active && "text-foreground",
                      )}
                    >
                      <ColumnTip tip={col.tip}>{col.label}</ColumnTip>
                      {renderSortIcon(col.key)}
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
                    <div className="truncate font-medium">{s.name}</div>
                    <div className="truncate text-[11px] tabular-nums text-muted-foreground">
                      {s.code}
                      {s.close != null && s.close > 0
                        ? ` · ${s.close.toLocaleString("zh-TW")}`
                        : ""}
                    </div>
                  </td>
                  <td
                    className={cn(
                      "px-2 py-2.5 text-right whitespace-nowrap tabular-nums sm:px-3",
                      signedClass(s.changePct),
                    )}
                  >
                    {formatPct(s.changePct)}
                  </td>
                  <td className="px-2 py-2.5 text-right whitespace-nowrap tabular-nums sm:px-3">
                    {formatYi(amt)}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-2.5 text-right whitespace-nowrap font-semibold tabular-nums sm:px-3",
                      signedClass(flow),
                    )}
                  >
                    {formatYiSigned(flow)}
                  </td>
                  <td
                    className={cn(
                      "hidden px-2 py-2.5 text-right whitespace-nowrap tabular-nums lg:table-cell sm:px-3",
                      signedClass(s.accel ?? 0),
                    )}
                  >
                    {formatYiSigned(s.accel ?? 0)}
                  </td>
                  <td className="hidden px-2 py-2.5 text-right whitespace-nowrap tabular-nums lg:table-cell sm:px-3">
                    {formatHeat(s.heat ?? 1)}
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
