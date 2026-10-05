"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import type { SectorFlow } from "@/lib/types";
import { STATUS_META } from "@/lib/types";
import {
  formatHeat,
  formatMarketYi,
  formatMarketYiSigned,
  formatPct,
  signedClass,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { MousePointerClick, X } from "lucide-react";
import { marketFromPath } from "@/components/market-switch";
import { UsStockName } from "@/components/us-stock-name";
import { Segmented } from "@/components/ui/segmented";
import { Stat } from "@/components/ui/stat";
import { StatusPill } from "@/components/ui/chip";
import { Amount } from "@/components/ui/amount";
import { EmptyState } from "@/components/ui/states";

type StockPeriod = "day" | "d3" | "d5";

type Props = {
  sector: SectorFlow | null;
  onClose: () => void;
  /** 與排行榜共用的時間維度（受控）；未傳則內部自管 */
  period?: StockPeriod;
  onPeriodChange?: (period: StockPeriod) => void;
  /** sheet：手機底部面板（外框由父層提供） */
  variant?: "panel" | "sheet";
};

const PERIOD_ITEMS = [
  { value: "day" as StockPeriod, label: "當日" },
  { value: "d3" as StockPeriod, label: "3 日" },
  { value: "d5" as StockPeriod, label: "5 日" },
];

export function SectorDetail({
  sector,
  onClose,
  period: periodProp,
  onPeriodChange,
  variant = "panel",
}: Props) {
  const pathname = usePathname();
  const market = marketFromPath(pathname);
  const isSheet = variant === "sheet";
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
      <div className="surface-outline flex h-full min-h-[420px] items-center">
        <EmptyState
          icon={<MousePointerClick className="size-4" aria-hidden />}
          title="點選排行榜看板塊明細"
          description="會顯示淨流、流入／流出、量能與成分股金流。"
        />
      </div>
    );
  }

  const meta = STATUS_META[sector.status];
  const amtLabel =
    stockPeriod === "day" ? "成交" : stockPeriod === "d3" ? "3日成交" : "5日成交";
  const flowLabel =
    stockPeriod === "day" ? "淨流" : stockPeriod === "d3" ? "3日流" : "5日流";

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col",
        isSheet
          ? "flex-1 overflow-hidden"
          : "surface max-h-full min-h-[420px] overflow-hidden",
      )}
    >
      <div
        className={cn(
          "flex items-start justify-between gap-3 border-b border-line px-4 py-3",
          isSheet && "border-b-0 pt-0 pb-2",
        )}
      >
        <div className="min-w-0">
          <p className="t-eyebrow mb-1">SECTOR DETAIL</p>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="t-title truncate">{sector.name}</h2>
            <StatusPill
              label={meta.label}
              color={meta.color}
              background={meta.bg}
            />
          </div>
        </div>
        {!isSheet ? (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sunken hover:text-foreground"
            aria-label="關閉"
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="scroll-y min-h-0 flex-1 overscroll-contain">
        <div className="grid grid-cols-2 gap-2 px-4 py-3 sm:grid-cols-3">
          <Stat
            label="當日淨流"
            value={<Amount text={formatMarketYiSigned(sector.dayFlow, market)} />}
            tone={sector.dayFlow}
          />
          <Stat
            label="流入／流出"
            value={`${formatMarketYi(sector.dayIn, market)} / ${formatMarketYi(sector.dayOut, market)}`}
            size="sm"
          />
          <Stat
            label="成交額"
            value={<Amount text={formatMarketYi(sector.dayAmt, market)} />}
          />
          <Stat
            label="近 3 日流"
            value={<Amount text={formatMarketYiSigned(sector.d3Flow, market)} />}
            tone={sector.d3Flow}
          />
          <Stat
            label="近 5 日流"
            value={<Amount text={formatMarketYiSigned(sector.d5Flow, market)} />}
            tone={sector.d5Flow}
          />
          <Stat
            label="加速度／日"
            value={<Amount text={formatMarketYiSigned(sector.accel, market)} />}
            tone={sector.accel}
          />
          <Stat label="量能熱度" value={formatHeat(sector.heat)} />
          <Stat
            label="20 日漲幅"
            value={formatPct(sector.priceChange20d)}
            tone={sector.priceChange20d}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5">
          <p className="t-kicker">成分股金流 · {stocks.length} 檔</p>
          <Segmented
            ariaLabel="成分股時間維度"
            size="sm"
            items={PERIOD_ITEMS}
            value={stockPeriod}
            onChange={setStockPeriod}
          />
        </div>

        {/* 手機：堆疊列（原本在 sheet 裡塞 5 欄表格，又擠又要橫捲） */}
        <ul className="divide-y divide-line md:hidden">
          {stocks.map((s) => {
            const amt =
              stockPeriod === "day" ? s.dayAmt : stockPeriod === "d3" ? s.d3 : s.d5;
            const flow =
              stockPeriod === "day"
                ? s.dayFlow
                : stockPeriod === "d3"
                  ? s.d3Flow
                  : s.d5Flow;
            return (
              <li
                key={s.code}
                className="flex items-center gap-3 px-4 py-2.5 text-sm"
              >
                <div className="min-w-0 flex-1">
                  {market === "us" ? (
                    <>
                      <p className="num font-medium">{s.code}</p>
                      <UsStockName
                        code={s.code}
                        name={s.name}
                        variant="compact"
                        emphasize={false}
                        className="block text-[0.6875rem] text-muted-foreground"
                      />
                    </>
                  ) : (
                    <>
                      <p className="truncate font-medium">{s.name}</p>
                      <p className="num text-[0.6875rem] text-muted-foreground">
                        {s.code}
                        {s.close != null && s.close > 0
                          ? ` · ${s.close.toFixed(s.close >= 100 ? 0 : 2)}`
                          : ""}
                      </p>
                    </>
                  )}
                </div>
                <div className="shrink-0 text-right text-xs">
                  <p className="text-muted-foreground">
                    {amtLabel}{" "}
                    <Amount
                      text={formatMarketYi(amt, market)}
                      className="text-foreground/80"
                    />
                  </p>
                  <p className="text-muted-foreground">
                    {flowLabel}{" "}
                    <Amount
                      text={formatMarketYiSigned(flow, market)}
                      className={cn("font-semibold", signedClass(flow))}
                    />
                  </p>
                </div>
                <span
                  className={cn(
                    "num w-14 shrink-0 text-right text-xs font-medium",
                    signedClass(s.changePct),
                  )}
                >
                  {formatPct(s.changePct)}
                </span>
              </li>
            );
          })}
        </ul>

        {/* 桌面：表格 */}
        <div className="hidden md:block">
          <table className="data-table">
            <thead>
              <tr>
                <th>代號／名稱</th>
                <th className="cell-num">股價</th>
                <th className="cell-num">{amtLabel}</th>
                <th className="cell-num">{flowLabel}</th>
                <th className="cell-num">漲跌</th>
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
                  <tr key={s.code}>
                    <td>
                      {market === "us" ? (
                        <>
                          <div className="num font-medium">{s.code}</div>
                          <UsStockName
                            code={s.code}
                            name={s.name}
                            variant="compact"
                            emphasize={false}
                            className="text-[0.6875rem] text-muted-foreground"
                          />
                        </>
                      ) : (
                        <>
                          <div className="truncate font-medium">{s.name}</div>
                          <div className="num text-[0.6875rem] text-muted-foreground">
                            {s.code}
                          </div>
                        </>
                      )}
                    </td>
                    <td className="cell-num">
                      {s.close != null && s.close > 0
                        ? s.close.toFixed(s.close >= 100 ? 0 : 2)
                        : "—"}
                    </td>
                    <td className="cell-num">
                      <Amount text={formatMarketYi(amt, market)} />
                    </td>
                    <td
                      className={cn("cell-num font-semibold", signedClass(flow))}
                    >
                      <Amount text={formatMarketYiSigned(flow, market)} />
                    </td>
                    <td className={cn("cell-num", signedClass(s.changePct))}>
                      {formatPct(s.changePct)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
