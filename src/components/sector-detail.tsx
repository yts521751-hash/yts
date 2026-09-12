"use client";

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

type Props = {
  sector: SectorFlow | null;
  onClose: () => void;
};

export function SectorDetail({ sector, onClose }: Props) {
  if (!sector) {
    return (
      <div className="flex h-full min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-[var(--panel)]/40 px-6 py-10 text-center">
        <p className="font-[family-name:var(--font-display)] text-lg text-foreground/80">
          點選排行榜看板塊
        </p>
        <p className="mt-2 max-w-xs text-sm text-muted-foreground">
          會列出成分股成交金額、資金流（成交×漲跌）與漲跌幅，並可進入產業 K 線。
        </p>
      </div>
    );
  }

  const meta = STATUS_META[sector.status];
  const stocks = [...sector.stocks].sort((a, b) => b.dayFlow - a.dayFlow);

  return (
    <div className="flex h-full min-h-[280px] flex-col rounded-2xl border border-border/60 bg-[var(--panel)]/80 shadow-sm backdrop-blur-sm animate-in fade-in slide-in-from-right-2 duration-300">
      <div className="flex items-start justify-between gap-3 border-b border-border/50 px-4 py-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
              {sector.name}
            </h2>
            <span
              className="rounded-md px-2 py-0.5 text-xs font-medium"
              style={{ background: meta.bg, color: meta.color }}
            >
              {meta.label}
            </span>
            {sector.volumeSpike && (
              <span className="rounded-md bg-[var(--tide-anchor-bg)] px-2 py-0.5 text-xs font-medium text-[var(--tide-anchor)]">
                大跌日放量
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{meta.hint}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          aria-label="關閉"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 px-4 py-3 sm:grid-cols-3">
        <Metric label="當日淨流" value={formatYiSigned(sector.dayFlow)} tone={sector.dayFlow} />
        <Metric
          label="流入／流出"
          value={`${formatYi(sector.dayIn)} / ${formatYi(sector.dayOut)}`}
        />
        <Metric label="成交額" value={formatYi(sector.dayAmt)} />
        <Metric label="近 5 日流" value={formatYiSigned(sector.d5Flow)} tone={sector.d5Flow} />
        <Metric label="加速度/日" value={formatYiSigned(sector.accel)} tone={sector.accel} />
        <Metric label="量能熱度" value={formatHeat(sector.heat)} />
      </div>

      <div className="px-4 pb-2">
        <Link
          href={`/sectors/${sector.id}`}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border/60 bg-muted/40 px-3 py-2 text-sm font-medium transition hover:bg-muted/70"
        >
          <CandlestickChart className="size-4" />
          產業 K 線與流入／流出
        </Link>
      </div>

      <ScrollArea className="flex-1 px-2 pb-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-muted-foreground">
              <th className="px-2 py-1.5 font-medium">代號／名稱</th>
              <th className="px-2 py-1.5 text-right font-medium">淨流</th>
              <th className="hidden px-2 py-1.5 text-right font-medium sm:table-cell">
                成交
              </th>
              <th className="px-2 py-1.5 text-right font-medium">漲跌</th>
            </tr>
          </thead>
          <tbody>
            {stocks.map((s) => (
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
                <td
                  className={cn(
                    "px-2 py-2 text-right tabular-nums font-medium",
                    signedClass(s.dayFlow),
                  )}
                >
                  {formatYiSigned(s.dayFlow)}
                </td>
                <td className="hidden px-2 py-2 text-right tabular-nums sm:table-cell">
                  {formatYi(s.dayAmt)}
                </td>
                <td className={cn("px-2 py-2 text-right tabular-nums", signedClass(s.changePct))}>
                  {formatPct(s.changePct)}
                </td>
              </tr>
            ))}
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
    <div className="rounded-xl bg-muted/40 px-2.5 py-2">
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
