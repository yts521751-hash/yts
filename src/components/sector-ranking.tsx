"use client";

import { useEffect, useMemo, useState } from "react";
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

export type RankPeriod = "day" | "d5";

type SortKey =
  | "amt"
  | "flow"
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

const KIND_LABEL: Record<Exclude<KindFilter, "all">, string> = {
  industry: "產業",
  theme: "題材",
  auto: "新興",
};

function periodAmt(s: SectorFlow, period: RankPeriod): number {
  return period === "day" ? s.dayAmt : s.d5;
}

function periodFlow(s: SectorFlow, period: RankPeriod): number {
  return period === "day" ? s.dayFlow : s.d5Flow;
}

function sortValue(s: SectorFlow, key: SortKey, period: RankPeriod): number {
  if (key === "amt") return periodAmt(s, period);
  if (key === "flow") return periodFlow(s, period);
  if (key === "cp") {
    const v = cpScore(s);
    return Number.isFinite(v) ? v : -1e12;
  }
  return s[key];
}

/** 「全部」時產業大板塊會淹沒題材；配額＋關鍵概念保底，讓矽光子等進前 30 */
const PIN_THEME_IDS = new Set([
  "optical",
  "ai-server",
  "liquid-cooling",
  "hbm-memory",
  "advanced-packaging",
]);

const RANK_LIMIT = 30;

function takeTopMixed(sorted: SectorFlow[], limit = RANK_LIMIT): SectorFlow[] {
  const themes = sorted.filter((s) => (s.kind ?? "theme") !== "industry");
  const industries = sorted.filter((s) => s.kind === "industry");
  const picked = new Map<string, SectorFlow>();

  for (const s of sorted) {
    if (PIN_THEME_IDS.has(s.id)) picked.set(s.id, s);
  }
  for (const s of themes.slice(0, 18)) picked.set(s.id, s);
  for (const s of industries.slice(0, 12)) picked.set(s.id, s);
  for (const s of sorted) {
    if (picked.size >= limit) break;
    picked.set(s.id, s);
  }

  if (picked.size <= limit) {
    return sorted.filter((s) => picked.has(s.id)).slice(0, limit);
  }

  // 超額時：保底題材優先保留，其餘依原排序截斷
  const ordered = sorted.filter((s) => picked.has(s.id));
  const pinned = ordered.filter((s) => PIN_THEME_IDS.has(s.id));
  const rest = ordered.filter((s) => !PIN_THEME_IDS.has(s.id));
  const keepIds = new Set(
    [...pinned, ...rest].slice(0, limit).map((s) => s.id),
  );
  return sorted.filter((s) => keepIds.has(s.id)).slice(0, limit);
}

export function SectorRanking({
  sectors,
  selectedId,
  onSelect,
  filter = "all",
  kindFilter = "all",
}: Props) {
  const [period, setPeriod] = useState<RankPeriod>("day");
  const [sortKey, setSortKey] = useState<SortKey>("amt");
  const [asc, setAsc] = useState(false);

  useEffect(() => {
    setSortKey("amt");
    setAsc(false);
  }, [period]);

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
      { key: "d20Flow" as const, label: "近 20 日流", hideSm: true },
      { key: "heat" as const, label: "量能", hideSm: true },
      { key: "priceChange20d" as const, label: "20 日漲幅", hideSm: true },
      { key: "cp" as const, label: "CP" },
    ],
    [period],
  );

  const { rows, totalMatched } = useMemo(() => {
    const list = sectors.filter((s) => {
      if (filter !== "all" && s.status !== filter) return false;
      if (kindFilter !== "all" && (s.kind ?? "theme") !== kindFilter) return false;
      return true;
    });
    const sorted = [...list].sort((a, b) => {
      const primary =
        sortValue(a, sortKey, period) - sortValue(b, sortKey, period);
      if (primary !== 0) return asc ? primary : -primary;
      // 第二順位：淨流；若主排序已是淨流，改以成交額決勝負
      if (sortKey === "flow") {
        const byAmt = periodAmt(a, period) - periodAmt(b, period);
        return asc ? byAmt : -byAmt;
      }
      const secondary = periodFlow(a, period) - periodFlow(b, period);
      return asc ? secondary : -secondary;
    });
    const rows =
      kindFilter === "all"
        ? takeTopMixed(sorted, RANK_LIMIT)
        : sorted.slice(0, RANK_LIMIT);
    return { rows, totalMatched: sorted.length };
  }, [sectors, filter, kindFilter, sortKey, asc, period]);

  return (
    <div className="flex h-full min-h-[320px] flex-col sm:min-h-[480px]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 px-2 pb-2 sm:px-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border/50 bg-muted/30 p-0.5">
            {(
              [
                ["day", "當日"],
                ["d5", "5 日"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setPeriod(key)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs transition",
                  period === key
                    ? "bg-background font-semibold text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {kindFilter !== "all" ? KIND_LABEL[kindFilter] : "全部"}
            {filter !== "all" ? ` · ${STATUS_META[filter].label}` : ""}
          </p>
        </div>
        <p className="text-[11px] tabular-nums text-muted-foreground">
          顯示前 {rows.length}（上限 {RANK_LIMIT}）
          {totalMatched > rows.length ? `／共 ${totalMatched}` : ""} 板塊 ·
          預設成交額→淨流
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-1 md:hidden">
        {rows.map((s, i) => {
          const meta = STATUS_META[s.status];
          const kind = (s.kind ?? "theme") as Exclude<KindFilter, "all">;
          const amt = periodAmt(s, period);
          const flow = periodFlow(s, period);
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
                  <span>
                    {period === "day" ? "成交" : "5日成交"} {formatYi(amt)}
                  </span>
                  <span className={signedClass(flow)}>
                    {period === "day" ? "淨流" : "5日流"} {formatYiSigned(flow)}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="hidden min-h-0 flex-1 overflow-auto md:block">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--panel)]/95 backdrop-blur-sm">
            <tr className="text-left text-[11px] text-muted-foreground">
              <th className="w-10 px-2 py-2.5 font-medium sm:px-3">#</th>
              <th className="px-2 py-2.5 font-medium sm:px-3">板塊</th>
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
              const amt = periodAmt(s, period);
              const flow = periodFlow(s, period);
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
                  <td className="px-2 py-2.5 text-right tabular-nums sm:px-3">
                    {formatYi(amt)}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-2.5 text-right font-medium tabular-nums sm:px-3",
                      signedClass(flow),
                    )}
                  >
                    {formatYiSigned(flow)}
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
