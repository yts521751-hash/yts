"use client";

import { useMemo, useState } from "react";
import type { SectorFlow, TideStatus } from "@/lib/types";
import { STATUS_META } from "@/lib/types";
import { cpScore } from "@/lib/mock-data";
import {
  formatHeat,
  formatPct,
  formatYi,
  formatYiSigned,
  signedClass,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

type SortKey =
  | "dayFlow"
  | "dayAmt"
  | "d5Flow"
  | "accel"
  | "d20Flow"
  | "heat"
  | "priceChange20d"
  | "cp";

type Props = {
  sectors: SectorFlow[];
  selectedId?: string | null;
  onSelect: (s: SectorFlow) => void;
  filter?: TideStatus | "all";
};

const COLUMNS: {
  key: SortKey;
  label: string;
  hint: string;
  hideSm?: boolean;
}[] = [
  { key: "dayFlow", label: "當日淨流", hint: "成交金額 × softSign(漲跌幅)（億）" },
  { key: "dayAmt", label: "成交額", hint: "當日成交金額合計（億）" },
  { key: "d5Flow", label: "近 5 日流", hint: "近 5 日淨資金流合計（億）" },
  {
    key: "accel",
    label: "加速度",
    hint: "近 5 日日均流 − 近 20 日日均流",
    hideSm: true,
  },
  {
    key: "d20Flow",
    label: "近 20 日流",
    hint: "近 20 日淨資金流合計（億）",
    hideSm: true,
  },
  {
    key: "heat",
    label: "量能",
    hint: "近 5 日日均成交 ÷ 近 20 日日均成交",
    hideSm: true,
  },
  {
    key: "priceChange20d",
    label: "20 日漲幅",
    hint: "近 20 日平均漲跌幅",
    hideSm: true,
  },
  { key: "cp", label: "CP", hint: "成交大、漲幅溫和、偏好淨流入" },
];

function sortValue(s: SectorFlow, key: SortKey): number {
  if (key === "cp") {
    const v = cpScore(s);
    return Number.isFinite(v) ? v : -1e12;
  }
  return s[key];
}

export function SectorRanking({
  sectors,
  selectedId,
  onSelect,
  filter = "all",
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("dayFlow");
  const [asc, setAsc] = useState(false);

  const rows = useMemo(() => {
    const list = sectors.filter((s) => filter === "all" || s.status === filter);
    return [...list].sort((a, b) => {
      const diff = sortValue(a, sortKey) - sortValue(b, sortKey);
      return asc ? diff : -diff;
    });
  }, [sectors, filter, sortKey, asc]);

  return (
    <div className="flex h-full min-h-[480px] flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 px-2 pb-2 sm:px-3">
        <p className="text-xs text-muted-foreground">
          資金流＝成交金額×漲跌方向 · 點欄位排序 · 點列看成分股
          {filter !== "all" ? (
            <span className="ml-1 text-foreground/80">
              · 篩選：{STATUS_META[filter].label}
            </span>
          ) : null}
        </p>
        <p className="text-[11px] tabular-nums text-muted-foreground">
          共 {rows.length} 板塊
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--panel)]/95 backdrop-blur-sm">
            <tr className="text-left text-[11px] text-muted-foreground">
              <th className="w-10 px-2 py-2.5 font-medium sm:px-3">#</th>
              <th className="px-2 py-2.5 font-medium sm:px-3">板塊</th>
              {COLUMNS.map((col) => {
                const active = sortKey === col.key;
                return (
                  <th
                    key={col.key}
                    className={cn(
                      "px-2 py-2.5 font-medium sm:px-3",
                      col.hideSm && "hidden md:table-cell",
                    )}
                  >
                    <button
                      type="button"
                      title={col.hint}
                      onClick={() => {
                        if (sortKey === col.key) setAsc((v) => !v);
                        else {
                          setSortKey(col.key);
                          setAsc(false);
                        }
                      }}
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
                        <ArrowUpDown className="size-3 opacity-40" />
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => {
              const meta = STATUS_META[s.status];
              const score = cpScore(s);
              return (
                <tr
                  key={s.id}
                  onClick={() => onSelect(s)}
                  className={cn(
                    "cursor-pointer border-t border-border/30 transition",
                    selectedId === s.id
                      ? "bg-[var(--tide-surge-bg)]"
                      : "hover:bg-muted/40",
                  )}
                >
                  <td className="px-2 py-2.5 tabular-nums text-muted-foreground sm:px-3">
                    {i + 1}
                  </td>
                  <td className="px-2 py-2.5 sm:px-3">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate font-medium">{s.name}</span>
                      <span
                        className="w-fit rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                        style={{ background: meta.bg, color: meta.color }}
                      >
                        {meta.label}
                        {s.volumeSpike ? " · 放量" : ""}
                      </span>
                    </div>
                  </td>
                  <td
                    className={cn(
                      "px-2 py-2.5 text-right tabular-nums font-medium sm:px-3",
                      signedClass(s.dayFlow),
                    )}
                  >
                    {formatYiSigned(s.dayFlow)}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums sm:px-3">
                    {formatYi(s.dayAmt)}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-2.5 text-right tabular-nums sm:px-3",
                      signedClass(s.d5Flow),
                    )}
                  >
                    {formatYiSigned(s.d5Flow)}
                  </td>
                  <td
                    className={cn(
                      "hidden px-2 py-2.5 text-right tabular-nums md:table-cell sm:px-3",
                      signedClass(s.accel),
                    )}
                  >
                    {formatYiSigned(s.accel)}
                  </td>
                  <td
                    className={cn(
                      "hidden px-2 py-2.5 text-right tabular-nums md:table-cell sm:px-3",
                      signedClass(s.d20Flow),
                    )}
                  >
                    {formatYiSigned(s.d20Flow, 0)}
                  </td>
                  <td className="hidden px-2 py-2.5 text-right tabular-nums text-muted-foreground md:table-cell sm:px-3">
                    {formatHeat(s.heat)}
                  </td>
                  <td
                    className={cn(
                      "hidden px-2 py-2.5 text-right tabular-nums md:table-cell sm:px-3",
                      signedClass(s.priceChange20d),
                    )}
                  >
                    {formatPct(s.priceChange20d)}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums font-semibold text-[var(--tide-surge)] sm:px-3">
                    {Number.isFinite(score) ? score.toFixed(0) : "—"}
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
