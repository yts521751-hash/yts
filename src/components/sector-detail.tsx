"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { SectorFlow } from "@/lib/types";
import { STATUS_META } from "@/lib/types";
import {
  formatHeat,
  formatPct,
  formatYi,
  formatYiSigned,
  signedClass,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CandlestickChart, X } from "lucide-react";

type StockPeriod = "day" | "d3" | "d5";

type Props = {
  sector: SectorFlow | null;
  onClose: () => void;
  /** 與排行榜共用的時間維度（受控）；未傳則內部自管 */
  period?: StockPeriod;
  onPeriodChange?: (period: StockPeriod) => void;
};

export function SectorDetail({
  sector,
  onClose,
  period: periodProp,
  onPeriodChange,
}: Props) {
  const [periodInner, setPeriodInner] = useState<StockPeriod>("day");
  const stockPeriod = periodProp ?? periodInner;
  const setStockPeriod = (next: StockPeriod) => {
    if (periodProp === undefined) setPeriodInner(next);
    onPeriodChange?.(next);
  };

  // 外層切換當日／3日／5日時，明細跟著同步
  useEffect(() => {
    if (periodProp !== undefined) setPeriodInner(periodProp);
  }, [periodProp]);

  const stocks = useMemo(() => {
    if (!sector) return [];
    const list = [...sector.stocks];
    list.sort((a, b) => {
      if (stockPeriod === "day") return b.dayAmt - a.dayAmt;
      if (stockPeriod === "d3") return b.d3 - a.d3 || b.d3Flow - a.d3Flow;
      return b.d5 - a.d5 || b.d5Flow - a.d5Flow;
    });
    return list;
  }, [sector, stockPeriod]);

  if (!sector) {
    return (
      <div className="flex h-full min-h-[280px] flex-col items-center justify-center border border-dashed border-border/70 bg-[var(--panel)]/40 px-6 py-10 text-center">
        <p className="font-[family-name:var(--font-display)] text-lg text-foreground/80">
          點選排行榜看板塊
        </p>
      </div>
    );
  }

  const meta = STATUS_META[sector.status];

  return (
    <div className="flex h-full min-h-[280px] flex-col border border-border/60 bg-[var(--panel)]/80 shadow-sm animate-in fade-in slide-in-from-right-2 duration-300">
      <div className="flex items-start justify-between gap-3 border-b border-border/50 px-4 py-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
              {sector.name}
            </h2>
            <span
              className="px-2 py-0.5 text-xs font-medium"
              style={{ background: meta.bg, color: meta.color }}
            >
              {meta.label}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          aria-label="關閉"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 px-4 py-3 sm:grid-cols-3">
        <Metric
          label="當日淨流"
          value={formatYiSigned(sector.dayFlow)}
          tone={sector.dayFlow}
        />
        <Metric
          label="流入／流出"
          value={`${formatYi(sector.dayIn)} / ${formatYi(sector.dayOut)}`}
        />
        <Metric label="成交額" value={formatYi(sector.dayAmt)} />
        <Metric
          label="近 3 日流"
          value={formatYiSigned(sector.d3Flow)}
          tone={sector.d3Flow}
        />
        <Metric
          label="近 5 日流"
          value={formatYiSigned(sector.d5Flow)}
          tone={sector.d5Flow}
        />
        <Metric
          label="加速度/日"
          value={formatYiSigned(sector.accel)}
          tone={sector.accel}
        />
        <Metric label="量能熱度" value={formatHeat(sector.heat)} />
      </div>

      <div className="px-4 pb-2">
        <Link
          href={`/sectors/${sector.id}`}
          className="inline-flex w-full items-center justify-center gap-2 border border-border/60 bg-muted/40 px-3 py-2 text-sm font-medium transition hover:bg-muted/70"
        >
          <CandlestickChart className="size-4" />
          產業 K 線
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-2">
        <p className="text-xs font-medium text-muted-foreground">成分股金流</p>
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
              onClick={() => setStockPeriod(key)}
              className={cn(
                "px-2 py-0.5 text-[11px] transition",
                stockPeriod === key
                  ? "bg-[var(--mk-anchor)] font-semibold text-white"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <ScrollArea className="flex-1 px-2 pb-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-muted-foreground">
              <th className="px-2 py-1.5 font-medium">代號／名稱</th>
              <th className="px-2 py-1.5 text-right font-medium">
                {stockPeriod === "day"
                  ? "成交"
                  : stockPeriod === "d3"
                    ? "3日成交"
                    : "5日成交"}
              </th>
              <th className="px-2 py-1.5 text-right font-medium">
                {stockPeriod === "day"
                  ? "淨流"
                  : stockPeriod === "d3"
                    ? "3日流"
                    : "5日流"}
              </th>
              <th className="px-2 py-1.5 text-right font-medium">漲跌</th>
            </tr>
          </thead>
          <tbody>
            {stocks.map((s) => {
              const amt =
                stockPeriod === "day"
                  ? s.dayAmt
                  : stockPeriod === "d3"
                    ? s.d3
                    : s.d5;
              const flow =
                stockPeriod === "day"
                  ? s.dayFlow
                  : stockPeriod === "d3"
                    ? s.d3Flow
                    : s.d5Flow;
              return (
                <tr
                  key={s.code}
                  className="border-t border-border/40 transition hover:bg-muted/40"
                >
                  <td className="px-2 py-2">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-[11px] tabular-nums text-muted-foreground">
                      {s.code}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {formatYi(amt)}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-2 text-right font-medium tabular-nums",
                      signedClass(flow),
                    )}
                  >
                    {formatYiSigned(flow)}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-2 text-right tabular-nums",
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
      </ScrollArea>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: number;
}) {
  return (
    <div className="bg-muted/40 px-2.5 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-sm font-semibold tabular-nums",
          tone !== undefined ? signedClass(tone) : undefined,
        )}
      >
        {value}
      </p>
    </div>
  );
}
