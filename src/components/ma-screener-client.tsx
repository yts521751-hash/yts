"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, RefreshCw } from "lucide-react";
import {
  CLIENT_CACHE_KEYS,
  readClientCache,
  writeClientCache,
} from "@/lib/client-cache";
import { formatYi, formatYiSigned, signedClass } from "@/lib/format";
import type { MaScreenerPayload, MaScreenerRow } from "@/lib/ma-screener-types";
import { cn } from "@/lib/utils";

type Filter = "all" | "ma5" | "ma10" | "ma20" | "all3";
type SortKey = "score" | "amt5" | "flow5" | "bias20" | "close";

function isAbove(close: number, ma: number | null | undefined) {
  return ma != null && close >= ma;
}

function rowFlags(row: MaScreenerRow) {
  const above5 = isAbove(row.close, row.ma5);
  const above10 = isAbove(row.close, row.ma10);
  const above20 = isAbove(row.close, row.ma20);
  return {
    above5,
    above10,
    above20,
    aboveAll: above5 && above10 && above20,
    aboveCount: Number(above5) + Number(above10) + Number(above20),
  };
}

function sortScore(row: MaScreenerRow) {
  const f = rowFlags(row);
  return (
    Number(f.aboveAll) * 8 +
    Number(f.above20) * 4 +
    Number(f.above10) * 2 +
    Number(f.above5)
  );
}

function sortValue(row: MaScreenerRow, key: SortKey) {
  if (key === "amt5") return row.amt5 ?? 0;
  if (key === "flow5") return row.flow5 ?? 0;
  if (key === "bias20") return row.bias20 ?? -999;
  if (key === "close") return row.close;
  return sortScore(row);
}

const FILTERS: Array<{ id: Filter; label: string; hint: string }> = [
  { id: "all", label: "全部產業", hint: "依站上均線數排序" },
  { id: "all3", label: "三線之上", hint: "同時站上 MA5／10／20" },
  { id: "ma5", label: "站上五日", hint: "收盤 ≥ MA5" },
  { id: "ma10", label: "站上十日", hint: "收盤 ≥ MA10" },
  { id: "ma20", label: "站上月線", hint: "收盤 ≥ MA20" },
];

const SORTS: Array<{ id: SortKey; label: string }> = [
  { id: "score", label: "站上強度" },
  { id: "amt5", label: "5日成交" },
  { id: "flow5", label: "5日淨流入" },
  { id: "bias20", label: "乖離20" },
];

function Bias({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground/50">—</span>;
  const up = value >= 0;
  return (
    <span className={up ? "text-[var(--mk-up)]" : "text-[var(--mk-down)]"}>
      {up ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}

function Flag({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
        on
          ? "bg-[var(--mk-surge-bg)] text-[var(--mk-surge)]"
          : "bg-muted text-muted-foreground/50",
      )}
      title={label}
    >
      {label}
    </span>
  );
}

function sectorHref(id: string) {
  return `/sectors/${encodeURIComponent(id)}?from=ma`;
}

function RowCard({ row }: { row: MaScreenerRow }) {
  const flags = rowFlags(row);
  return (
    <Link
      href={sectorHref(row.id)}
      className="block rounded-xl border border-border/50 bg-[var(--panel)]/70 p-3.5 transition hover:border-[var(--mk-anchor)]/40 hover:bg-muted/30"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium">{row.name}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            收盤 {row.close.toFixed(2)} · 站上 {flags.aboveCount}/3
            {row.ma20 == null ? " · 月線未就緒" : ""}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          <Flag on={flags.above5} label="5" />
          <Flag on={flags.above10} label="10" />
          <Flag on={flags.above20} label="20" />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-lg bg-muted/40 px-2.5 py-2">
          <div className="text-muted-foreground">5日成交</div>
          <div className="mt-0.5 font-semibold tabular-nums">
            {formatYi(row.amt5 ?? 0)}
          </div>
        </div>
        <div className="rounded-lg bg-muted/40 px-2.5 py-2">
          <div className="text-muted-foreground">5日淨流入</div>
          <div
            className={cn(
              "mt-0.5 font-semibold tabular-nums",
              signedClass(row.flow5 ?? 0),
            )}
          >
            {formatYiSigned(row.flow5 ?? 0)}
          </div>
        </div>
      </div>
    </Link>
  );
}

function seedFrom(
  initial: MaScreenerPayload | null,
): { data: MaScreenerPayload | null; fromCache: boolean } {
  const usable = (p: MaScreenerPayload | null) => {
    if (!p?.rows?.length) return false;
    const noMa20 = p.rows.filter((r) => r.ma20 == null).length;
    // 舊本機快取多數無月線 → 丟掉，改等伺服器
    return noMa20 < Math.ceil(p.rows.length * 0.5);
  };
  if (usable(initial)) return { data: initial, fromCache: false };
  if (typeof window === "undefined") return { data: null, fromCache: false };
  const cached = readClientCache<MaScreenerPayload>(CLIENT_CACHE_KEYS.ma);
  if (usable(cached)) return { data: cached, fromCache: true };
  return { data: usable(initial) ? initial : null, fromCache: false };
}

export function MaScreenerClient({
  initial,
}: {
  initial: MaScreenerPayload | null;
}) {
  const seeded = seedFrom(initial);
  const [data, setData] = useState<MaScreenerPayload | null>(() => seeded.data);
  const [loading, setLoading] = useState(() => !seeded.data?.rows?.length);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [asc, setAsc] = useState(false);
  const [fromCache, setFromCache] = useState(() => seeded.fromCache);

  const hasRowsRef = useRef(Boolean(seeded.data?.rows?.length));
  useEffect(() => {
    hasRowsRef.current = Boolean(data?.rows?.length);
  }, [data?.rows?.length]);

  const load = useCallback(async (force = false) => {
    setError(null);
    if (force) setRefreshing(true);
    try {
      const res = await fetch(`/api/ma-screener${force ? "?force=1" : ""}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as MaScreenerPayload & {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || json.ok === false) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      if (json.rows?.length) {
        setData(json);
        setFromCache(false);
        writeClientCache(CLIENT_CACHE_KEYS.ma, json);
        hasRowsRef.current = true;
      } else if (!hasRowsRef.current) {
        setData(json);
      }
    } catch (e) {
      if (!hasRowsRef.current) {
        setError(e instanceof Error ? e.message : "載入失敗");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (seeded.data?.rows?.length) {
      setLoading(false);
      // 有可用快照就略過自動重抓；手動「重新掃描」才 force
      return;
    }
    void load(false);
  }, [load, seeded.data?.rows?.length]);

  const filtered = useMemo(() => {
    const rows = data?.rows ?? [];
    let list = rows;
    if (filter === "ma5") list = rows.filter((r) => rowFlags(r).above5);
    else if (filter === "ma10") list = rows.filter((r) => rowFlags(r).above10);
    else if (filter === "ma20") list = rows.filter((r) => rowFlags(r).above20);
    else if (filter === "all3") list = rows.filter((r) => rowFlags(r).aboveAll);

    return [...list].sort((a, b) => {
      const d = sortValue(a, sortKey) - sortValue(b, sortKey);
      if (d !== 0) return asc ? d : -d;
      return (b.amt5 ?? 0) - (a.amt5 ?? 0);
    });
  }, [data, filter, sortKey, asc]);

  const summary = useMemo(() => {
    const rows = data?.rows ?? [];
    let ma5 = 0;
    let ma10 = 0;
    let ma20 = 0;
    let all3 = 0;
    for (const r of rows) {
      const f = rowFlags(r);
      if (f.above5) ma5++;
      if (f.above10) ma10++;
      if (f.above20) ma20++;
      if (f.aboveAll) all3++;
    }
    return { ma5, ma10, ma20, all3, total: rows.length };
  }, [data?.rows]);

  const shortBars = useMemo(
    () => (data?.rows ?? []).filter((r) => (r.bars ?? 0) < 20).length,
    [data?.rows],
  );

  const activeHint = FILTERS.find((f) => f.id === filter)?.hint ?? "";

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setAsc((v) => !v);
    else {
      setSortKey(key);
      setAsc(false);
    }
  };

  return (
    <div className="relative min-h-full flex-1 pb-20 md:pb-6">
      <div className="studio-atmosphere pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative z-10 mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            回資金流
          </Link>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border/50 bg-muted/30 px-3 py-2 text-xs font-medium transition hover:bg-muted/60 disabled:opacity-50"
          >
            <RefreshCw
              className={cn("size-3.5", (loading || refreshing) && "animate-spin")}
            />
            重新掃描
          </button>
        </div>

        <h1 className="mt-4 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
          產業均線掃描
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          找出產業指數收盤站上五日、十日、二十日線的族群，並顯示近五日成交與淨流入。點欄位可排序。
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          資料來源：臺灣證券交易所、證券櫃檯買賣中心公開資料
          {data?.asOf ? ` · 資料日 ${data.asOf}` : ""}
          {data?.builtAt
            ? ` · 更新 ${new Date(data.builtAt).toLocaleString("zh-TW", { hour12: false })}`
            : ""}
          {fromCache ? " · 本機快取" : ""}
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const count =
              f.id === "all"
                ? summary.total
                : f.id === "ma5"
                  ? summary.ma5
                  : f.id === "ma10"
                    ? summary.ma10
                    : f.id === "ma20"
                      ? summary.ma20
                      : summary.all3;
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-xs font-semibold transition",
                  active
                    ? "border-[var(--mk-anchor)] bg-[var(--mk-anchor)] text-white"
                    : "border-border/50 bg-[var(--panel)]/70 text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
                <span
                  className={cn(
                    "ml-1.5 tabular-nums",
                    active ? "opacity-80" : "opacity-50",
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">{activeHint}</p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {SORTS.map((s) => {
            const active = sortKey === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleSort(s.id)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition",
                  active
                    ? "border-[var(--mk-surge)]/50 bg-[var(--mk-surge-bg)] font-semibold text-foreground"
                    : "border-border/50 bg-[var(--panel)]/70 text-muted-foreground",
                )}
              >
                {s.label}
                {active ? (
                  asc ? (
                    <ArrowUp className="size-3" />
                  ) : (
                    <ArrowDown className="size-3" />
                  )
                ) : (
                  <ArrowUpDown className="size-3 opacity-40" />
                )}
              </button>
            );
          })}
        </div>

        {shortBars > 0 ? (
          <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
            有 {shortBars} 個產業日線不足 20 根，月線／三線可能暫時無法判定；請按「重新掃描」補建報價歷史。
          </p>
        ) : null}

        {error ? (
          <div className="mt-6 rounded-xl border border-[var(--mk-down)]/30 bg-[var(--mk-down)]/10 px-4 py-3 text-sm text-[var(--mk-down)]">
            {error}
          </div>
        ) : null}

        {loading && !data?.rows?.length ? (
          <div className="mt-6 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-xl border border-border/40 bg-[var(--panel)]/40"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-6 rounded-xl border border-border/50 bg-[var(--panel)]/60 px-5 py-10 text-center text-sm text-muted-foreground">
            目前沒有符合「{FILTERS.find((f) => f.id === filter)?.label}」的產業。
            {shortBars > 0 || (data?.rows ?? []).some((r) => r.ma20 == null)
              ? " 日線／月線尚未就緒，請按「重新掃描」。"
              : ""}
          </div>
        ) : (
          <>
            <div className="mt-6 grid gap-3 md:hidden">
              {filtered.map((row) => (
                <RowCard key={row.id} row={row} />
              ))}
            </div>

            <div className="mt-6 hidden overflow-x-auto rounded-xl border border-border/50 bg-[var(--panel)]/70 md:block">
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead className="border-b border-border/50 bg-muted/30 text-[11px] text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">產業</th>
                    <th className="px-3 py-3 font-medium">收盤</th>
                    <th className="px-3 py-3 font-medium">站上</th>
                    <th className="px-3 py-3 font-medium">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        onClick={() => toggleSort("amt5")}
                      >
                        5日成交
                        {sortKey === "amt5" ? (
                          asc ? (
                            <ArrowUp className="size-3" />
                          ) : (
                            <ArrowDown className="size-3" />
                          )
                        ) : (
                          <ArrowUpDown className="size-3 opacity-40" />
                        )}
                      </button>
                    </th>
                    <th className="px-3 py-3 font-medium">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        onClick={() => toggleSort("flow5")}
                      >
                        5日淨流入
                        {sortKey === "flow5" ? (
                          asc ? (
                            <ArrowUp className="size-3" />
                          ) : (
                            <ArrowDown className="size-3" />
                          )
                        ) : (
                          <ArrowUpDown className="size-3 opacity-40" />
                        )}
                      </button>
                    </th>
                    <th className="px-3 py-3 font-medium">乖離5</th>
                    <th className="px-3 py-3 font-medium">乖離10</th>
                    <th className="px-4 py-3 font-medium">乖離20</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => {
                    const flags = rowFlags(row);
                    return (
                      <tr
                        key={row.id}
                        className="border-b border-border/30 transition hover:bg-muted/30"
                      >
                        <td className="px-4 py-3">
                          <Link
                            href={sectorHref(row.id)}
                            className="font-medium hover:text-[var(--mk-anchor)]"
                          >
                            {row.name}
                          </Link>
                        </td>
                        <td className="px-3 py-3 tabular-nums text-muted-foreground">
                          {row.close.toFixed(2)}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex gap-1">
                            <Flag on={flags.above5} label="5" />
                            <Flag on={flags.above10} label="10" />
                            <Flag on={flags.above20} label="20" />
                          </div>
                        </td>
                        <td className="px-3 py-3 tabular-nums">
                          {formatYi(row.amt5 ?? 0)}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-3 tabular-nums",
                            signedClass(row.flow5 ?? 0),
                          )}
                        >
                          {formatYiSigned(row.flow5 ?? 0)}
                        </td>
                        <td className="px-3 py-3 tabular-nums">
                          <Bias value={row.bias5} />
                        </td>
                        <td className="px-3 py-3 tabular-nums">
                          <Bias value={row.bias10} />
                        </td>
                        <td className="px-4 py-3 tabular-nums">
                          <Bias value={row.bias20} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
