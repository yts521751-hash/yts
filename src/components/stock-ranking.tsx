"use client";

import { useMemo, useState } from "react";
import type { StockFlow } from "@/lib/types";
import {
  formatHeat,
  formatMarketTurnoverYi,
  formatMarketYiSigned,
  formatPct,
  signedClass,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { COLUMN_TIPS, ColumnTip } from "@/components/column-tip";
import { UsStockName } from "@/components/us-stock-name";
import type { MarketId } from "@/components/market-switch";
import { Segmented } from "@/components/ui/segmented";
import { Amount } from "@/components/ui/amount";
import {
  Chip,
  RankSlot,
  SortChip,
  SortHeaderButton,
  type SortState,
} from "@/components/ui/chip";

export type StockRankPeriod = "day" | "d3" | "d5";

type SortKey =
  | "changePct"
  | "amt"
  | "flow"
  | "accel"
  | "heat"
  | "revenueYoy"
  | "epsGrowth";

export type StockFlowRankRow = StockFlow & {
  accel?: number;
  heat?: number;
  close?: number;
  revenueYoy?: number | null;
  revenueMonth?: string | null;
  epsGrowth?: number | null;
  nextYearEps?: number | null;
  baseEps?: number | null;
  nameEn?: string;
  nameZh?: string;
};

type Props = {
  rows: StockFlowRankRow[];
  limit?: number;
  market?: MarketId;
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
  if (key === "revenueYoy") return s.revenueYoy ?? Number.NEGATIVE_INFINITY;
  if (key === "epsGrowth") return s.epsGrowth ?? Number.NEGATIVE_INFINITY;
  return s.changePct;
}

const RANK_LIMIT = 20;

const PERIOD_ITEMS = [
  { value: "day" as StockRankPeriod, label: "當日" },
  { value: "d3" as StockRankPeriod, label: "3 日" },
  { value: "d5" as StockRankPeriod, label: "5 日" },
];

export function StockRanking({ rows, limit = RANK_LIMIT, market = "tw" }: Props) {
  const [period, setPeriod] = useState<StockRankPeriod>("day");
  const [sortKey, setSortKey] = useState<SortKey>("amt");
  const [asc, setAsc] = useState(false);
  const isUs = market === "us";

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
      {
        key: "revenueYoy",
        label: "營收YoY",
        tip: COLUMN_TIPS.revenueYoy,
      },
      {
        key: "epsGrowth",
        label: "EPS成長",
        tip: COLUMN_TIPS.epsGrowth,
      },
    ],
    [period],
  );

  const ranked = useMemo(() => {
    const sorted = [...rows].sort((a, b) => {
      const primary =
        sortValue(a, sortKey, period) - sortValue(b, sortKey, period);
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

  const sortState = (key: SortKey): SortState =>
    sortKey === key ? (asc ? "asc" : "desc") : "none";

  return (
    <div className="flex h-full min-h-[360px] flex-col sm:min-h-[520px]">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            ariaLabel="時間維度"
            size="sm"
            items={PERIOD_ITEMS}
            value={period}
            onChange={(next) => {
              setPeriod(next);
              setSortKey("amt");
              setAsc(false);
            }}
          />
          <Chip tone="outline">個股金流</Chip>
        </div>
        <p className="t-kicker">
          TOP {ranked.length} / {rows.length} 檔 · 預設成交額→淨流
        </p>
      </div>

      <div className="scroll-x flex gap-2 border-b border-line px-3 py-2 md:hidden">
        {columns.map((col) => (
          <SortChip
            key={col.key}
            label={col.label}
            state={sortState(col.key)}
            onClick={() => onSort(col.key)}
          />
        ))}
      </div>

      <div className="scroll-y min-h-0 flex-1 md:hidden">
        <ul className="divide-y divide-line">
          {ranked.map((s, i) => {
            const amt = periodAmt(s, period);
            const flow = periodFlow(s, period);
            return (
              <li
                key={s.code}
                className="flex min-h-[4.5rem] items-center gap-3 px-3 py-3"
              >
                <RankSlot rank={i + 1} emphasis />
                <div className="min-w-0 flex-1">
                  {isUs ? (
                    <>
                      <p className="num text-[0.9375rem] font-semibold">
                        {s.code}
                      </p>
                      <UsStockName
                        code={s.code}
                        nameEn={s.nameEn}
                        nameZh={s.nameZh}
                        name={s.name}
                        variant="compact"
                        emphasize={false}
                        className="mt-0.5 block text-xs text-muted-foreground"
                      />
                    </>
                  ) : (
                    <p className="truncate text-[0.9375rem] font-medium">
                      {s.name}
                    </p>
                  )}
                  <p className="mt-1 flex flex-wrap items-baseline gap-x-2.5 text-xs text-muted-foreground">
                    {!isUs ? <span className="num">{s.code}</span> : null}
                    {s.close != null && s.close > 0 ? (
                      <span className="num">
                        {s.close.toLocaleString(isUs ? "en-US" : "zh-TW")}
                      </span>
                    ) : null}
                    <span className={cn("num font-medium", signedClass(s.changePct))}>
                      {formatPct(s.changePct)}
                    </span>
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <Amount
                    text={formatMarketTurnoverYi(amt, market)}
                    className="block text-[0.9375rem] font-semibold"
                  />
                  <Amount
                    text={formatMarketYiSigned(flow, market)}
                    className={cn("block text-xs font-medium", signedClass(flow))}
                  />
                  {!isUs ? (
                    <p className="mt-0.5 text-[0.6875rem] whitespace-nowrap text-muted-foreground">
                      營收{" "}
                      <span
                        className={cn(
                          "num",
                          s.revenueYoy == null ? "" : signedClass(s.revenueYoy),
                        )}
                      >
                        {s.revenueYoy == null ? "—" : formatPct(s.revenueYoy)}
                      </span>
                      {" · EPS "}
                      <span
                        className={cn(
                          "num",
                          s.epsGrowth == null ? "" : signedClass(s.epsGrowth),
                        )}
                      >
                        {s.epsGrowth == null ? "—" : formatPct(s.epsGrowth)}
                      </span>
                    </p>
                  ) : s.epsGrowth != null ? (
                    <p className="mt-0.5 text-[0.6875rem] whitespace-nowrap text-muted-foreground">
                      EPS{" "}
                      <span className={cn("num", signedClass(s.epsGrowth))}>
                        {formatPct(s.epsGrowth)}
                      </span>
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="scroll-x hidden min-h-0 flex-1 md:block">
        <table className="data-table min-w-[840px] table-fixed">
          <colgroup>
            <col className="w-10" />
            <col className="w-[22%]" />
            <col className="w-[10%]" />
            <col className="w-[11%]" />
            <col className="w-[11%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
          </colgroup>
          <thead>
            <tr>
              <th className="text-right">#</th>
              <th>個股</th>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn("cell-num", col.hideLg && "hidden lg:table-cell")}
                >
                  <SortHeaderButton
                    state={sortState(col.key)}
                    onClick={() => onSort(col.key)}
                  >
                    <ColumnTip tip={col.tip}>{col.label}</ColumnTip>
                  </SortHeaderButton>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ranked.map((s, i) => {
              const amt = periodAmt(s, period);
              const flow = periodFlow(s, period);
              return (
                <tr
                  key={s.code}
                  className="rank-row-enter"
                  style={{ animationDelay: `${Math.min(i, 12) * 20}ms` }}
                >
                  <td className="num text-right text-muted-foreground">{i + 1}</td>
                  <td>
                    {isUs ? (
                      <>
                        <div className="num font-medium">{s.code}</div>
                        <UsStockName
                          code={s.code}
                          nameEn={s.nameEn}
                          nameZh={s.nameZh}
                          name={s.name}
                          variant="compact"
                          className="text-[0.6875rem] text-muted-foreground"
                          emphasize={false}
                        />
                      </>
                    ) : (
                      <>
                        <div className="truncate font-medium">{s.name}</div>
                        <div className="num truncate text-[0.6875rem] text-muted-foreground">
                          {s.code}
                          {s.close != null && s.close > 0
                            ? ` · ${s.close.toLocaleString("zh-TW")}`
                            : ""}
                        </div>
                      </>
                    )}
                  </td>
                  <td className={cn("cell-num", signedClass(s.changePct))}>
                    {formatPct(s.changePct)}
                  </td>
                  <td className="cell-num">
                    <Amount text={formatMarketTurnoverYi(amt, market)} />
                  </td>
                  <td className={cn("cell-num font-semibold", signedClass(flow))}>
                    <Amount text={formatMarketYiSigned(flow, market)} />
                  </td>
                  <td
                    className={cn(
                      "cell-num hidden lg:table-cell",
                      signedClass(s.accel ?? 0),
                    )}
                  >
                    <Amount text={formatMarketYiSigned(s.accel ?? 0, market)} />
                  </td>
                  <td className="cell-num hidden text-muted-foreground lg:table-cell">
                    {formatHeat(s.heat ?? 1)}
                  </td>
                  <td
                    className={cn(
                      "cell-num",
                      s.revenueYoy == null
                        ? "text-muted-foreground"
                        : signedClass(s.revenueYoy),
                    )}
                  >
                    {s.revenueYoy == null ? "—" : formatPct(s.revenueYoy)}
                  </td>
                  <td
                    className={cn(
                      "cell-num",
                      s.epsGrowth == null
                        ? "text-muted-foreground"
                        : signedClass(s.epsGrowth),
                    )}
                    title={
                      s.nextYearEps != null && s.baseEps != null
                        ? `法人共識中位數 EPS ${s.nextYearEps} / 本年度 ${s.baseEps}`
                        : undefined
                    }
                  >
                    {s.epsGrowth == null ? "—" : formatPct(s.epsGrowth)}
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
