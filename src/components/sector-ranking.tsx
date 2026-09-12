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

export type KindFilter = "all" | "industry" | "theme" | "auto";

type Props = {
  sectors: SectorFlow[];
  selectedId?: string | null;
  onSelect: (s: SectorFlow) => void;
  filter?: TideStatus | "all";
  kindFilter?: KindFilter;
};

const COLUMNS: {
  key: SortKey;
  label: string;
  hideSm?: boolean;
}[] = [
  { key: "dayFlow", label: "當日淨流" },
  { key: "dayAmt", label: "成交額" },
  { key: "d5Flow", label: "近 5 日流" },
  { key: "accel", label: "加速度", hideSm: true },
  { key: "d20Flow", label: "近 20 日流", hideSm: true },
  { key: "heat", label: "量能", hideSm: true },
  { key: "priceChange20d", label: "20 日漲幅", hideSm: true },
  { key: "cp", label: "CP" },
];

const KIND_LABEL: Record<Exclude<KindFilter, "all">, string> = {
  industry: "產業",
  theme: "題材",
  auto: "新興",
};

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
  kindFilter = "all",
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("dayFlow");
  const [asc, setAsc] = useState(false);

  const rows = useMemo(() => {
    const list = sectors.filter((s) => {
      if (filter !== "all" && s.status !== filter) return false;
      if (kindFilter !== "all" && (s.kind ?? "theme") !== kindFilter) return false;
      return true;
    });
    return [...list].sort((a, b) => {
      const diff = sortValue(a, sortKey) - sortValue(b, sortKey);
      return asc ? diff : -diff;
    });
  }, [sectors, filter, kindFilter, sortKey, asc]);

  return (
    <div className="flex h-full min-h-[320px] flex-col sm:min-h-[480px]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 px-2 pb-2 sm:px-3">
        <p className="text-xs text-muted-foreground">
          {kindFilter !== "all" ? KIND_LABEL[kindFilter] : "全部"}
          {filter !== "all" ? ` · ${STATUS_META[filter].label}` : ""}
        </p>
        <p className="text-[11px] tabular-nums text-muted-foreground">
          共 {rows.length} 板塊
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-1 md:hidden">
        {rows.map((s, i) => {
          const meta = STATUS_META[s.status];
          const kind = (s.kind ?? "theme") as Exclude<KindFilter, "all">;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                selectedId === s.id
                  ? "border-transparent bg-[var(--mk-surge-bg)] ring-1 ring-[var(--mk-surge)]"
                  : "border-border/40 bg-[var(--panel)]/50 hover:bg-muted/40",
              )}
            >
              <span className="w-6 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate font-medium">{s.name}</span>
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                    style={{ background: meta.bg, color: meta.color }}
                  >
                    {meta.label}
                  </span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {KIND_LABEL[kind]}
                  </span>
                </div>
                <div className="mt-0.5 flex gap-3 text-[11px] text-muted-foreground">
                  <span>成交 {formatYi(s.dayAmt)}</span>
                  <span className={signedClass(s.dayFlow)}>
                    淨流 {formatYiSigned(s.dayFlow)}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="hidden min-h-0 flex-1 overflow-auto md:block">
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
                      col.hideSm && "hidden lg:table-cell",
                    )}
                  >
                    <button
                      type="button"
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
              const kind = (s.kind ?? "theme") as Exclude<KindFilter, "all">;
              return (
                <tr
                  key={s.id}
                  onClick={() => onSelect(s)}
                  className={cn(
                    "cursor-pointer border-t border-border/30 transition",
                    selectedId === s.id
                      ? "bg-[var(--mk-surge-bg)]"
                      : "hover:bg-muted/40",
                  )}
                >
                  <td className="px-2 py-2.5 tabular-nums text-muted-foreground sm:px-3">
                    {i + 1}
                  </td>
                  <td className="px-2 py-2.5 sm:px-3">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate font-medium">{s.name}</span>
                      <div className="flex flex-wrap gap-1">
                        <span
                          className="w-fit rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                          style={{ background: meta.bg, color: meta.color }}
                        >
                          {meta.label}
                          {s.volumeSpike ? " · 放量" : ""}
                        </span>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {KIND_LABEL[kind]}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td
                    className={cn(
                      "px-2 py-2.5 text-right font-medium tabular-nums sm:px-3",
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
                      "hidden px-2 py-2.5 text-right tabular-nums lg:table-cell sm:px-3",
                      signedClass(s.accel),
                    )}
                  >
                    {formatYiSigned(s.accel)}
                  </td>
                  <td
                    className={cn(
                      "hidden px-2 py-2.5 text-right tabular-nums lg:table-cell sm:px-3",
                      signedClass(s.d20Flow),
                    )}
                  >
                    {formatYiSigned(s.d20Flow, 0)}
                  </td>
                  <td className="hidden px-2 py-2.5 text-right tabular-nums text-muted-foreground lg:table-cell sm:px-3">
                    {formatHeat(s.heat)}
                  </td>
                  <td
                    className={cn(
                      "hidden px-2 py-2.5 text-right tabular-nums lg:table-cell sm:px-3",
                      signedClass(s.priceChange20d),
                    )}
                  >
                    {formatPct(s.priceChange20d)}
                  </td>
                  <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-[var(--mk-surge)] sm:px-3">
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
