"use client";

import { useMemo, useState } from "react";
import type { SectorFlow, TideStatus } from "@/lib/types";
import { STATUS_META } from "@/lib/types";
import { cpScore } from "@/lib/mock-data";
import { formatPct, formatYi, signedClass } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

type SortKey =
  | "d5"
  | "accel"
  | "d20Net"
  | "d20Abs"
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
  className?: string;
  hideSm?: boolean;
}[] = [
  { key: "d5", label: "近 5 日", hint: "近 5 日法人累計買賣超（億）" },
  {
    key: "accel",
    label: "加速度",
    hint: "相對近 20 日日均的加減買力道",
    hideSm: true,
  },
  {
    key: "d20Net",
    label: "近 20 日淨額",
    hint: "近 20 日法人累計淨額（億）",
  },
  {
    key: "d20Abs",
    label: "規模",
    hint: "近 20 日買賣金額規模（億）",
    hideSm: true,
  },
  {
    key: "priceChange20d",
    label: "20 日漲幅",
    hint: "板塊代表股近 20 日漲跌幅",
    hideSm: true,
  },
  { key: "cp", label: "CP", hint: "資金流入多、漲幅仍溫和者較高" },
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
  const [sortKey, setSortKey] = useState<SortKey>("d5");
  const [asc, setAsc] = useState(false);

  const rows = useMemo(() => {
    const list = sectors.filter(
      (s) => filter === "all" || s.status === filter,
    );
    return [...list].sort((a, b) => {
      const diff = sortValue(a, sortKey) - sortValue(b, sortKey);
      return asc ? diff : -diff;
    });
  }, [sectors, filter, sortKey, asc]);

  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setAsc((v) => !v);
    } else {
      setSortKey(key);
      setAsc(false);
    }
  };

  return (
    <div className="flex h-full min-h-[480px] flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 px-2 pb-2 sm:px-3">
        <p className="text-xs text-muted-foreground">
          點欄位標題排序 · 點列看成分股
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
        <table className="w-full min-w-[640px] border-collapse text-sm">
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
                      col.className,
                    )}
                  >
                    <button
                      type="button"
                      title={col.hint}
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
              const selected = selectedId === s.id;
              return (
                <tr
                  key={s.id}
                  onClick={() => onSelect(s)}
                  className={cn(
                    "cursor-pointer border-t border-border/30 transition",
                    selected
                      ? "bg-[var(--tide-surge-bg)]"
                      : "hover:bg-muted/40",
                  )}
                >
                  <td className="px-2 py-2.5 font-[family-name:var(--font-display)] tabular-nums text-muted-foreground sm:px-3">
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
                        {s.contrarian ? " · 逆勢" : ""}
                      </span>
                    </div>
                  </td>
                  <td
                    className={cn(
                      "px-2 py-2.5 text-right tabular-nums sm:px-3",
                      signedClass(s.d5),
                    )}
                  >
                    {formatYi(s.d5)}
                  </td>
                  <td
                    className={cn(
                      "hidden px-2 py-2.5 text-right tabular-nums md:table-cell sm:px-3",
                      signedClass(s.accel),
                    )}
                  >
                    {formatYi(s.accel)}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-2.5 text-right tabular-nums sm:px-3",
                      signedClass(s.d20Net),
                    )}
                  >
                    {formatYi(s.d20Net)}
                  </td>
                  <td className="hidden px-2 py-2.5 text-right tabular-nums text-muted-foreground md:table-cell sm:px-3">
                    {formatYi(s.d20Abs, 0)}
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
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-12 text-center text-sm text-muted-foreground"
                >
                  這個潮態目前沒有板塊
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
