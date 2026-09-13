"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import {
  CLIENT_CACHE_KEYS,
  readClientCache,
  writeClientCache,
} from "@/lib/client-cache";
import type { MaScreenerPayload, MaScreenerRow } from "@/lib/ma-screener-types";
import { cn } from "@/lib/utils";

type Filter = "all" | "ma5" | "ma10" | "ma20" | "all3";

const FILTERS: Array<{ id: Filter; label: string; hint: string }> = [
  { id: "all", label: "全部產業", hint: "依站上均線數排序" },
  { id: "all3", label: "三線之上", hint: "同時站上 MA5／10／20" },
  { id: "ma5", label: "站上五日", hint: "收盤 ≥ MA5" },
  { id: "ma10", label: "站上十日", hint: "收盤 ≥ MA10" },
  { id: "ma20", label: "站上月線", hint: "收盤 ≥ MA20" },
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

function RowCard({ row }: { row: MaScreenerRow }) {
  return (
    <Link
      href={`/sectors/${encodeURIComponent(row.id)}`}
      className="block rounded-xl border border-border/50 bg-[var(--panel)]/70 p-3.5 transition hover:border-[var(--mk-anchor)]/40 hover:bg-muted/30"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium">{row.name}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            收盤 {row.close.toFixed(2)} · 站上 {row.aboveCount}/3
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          <Flag on={row.above5} label="5" />
          <Flag on={row.above10} label="10" />
          <Flag on={row.above20} label="20" />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
        <div className="rounded-lg bg-muted/40 px-2.5 py-2">
          <div className="text-muted-foreground">乖離5</div>
          <div className="mt-0.5 font-semibold tabular-nums">
            <Bias value={row.bias5} />
          </div>
        </div>
        <div className="rounded-lg bg-muted/40 px-2.5 py-2">
          <div className="text-muted-foreground">乖離10</div>
          <div className="mt-0.5 font-semibold tabular-nums">
            <Bias value={row.bias10} />
          </div>
        </div>
        <div className="rounded-lg bg-muted/40 px-2.5 py-2">
          <div className="text-muted-foreground">乖離20</div>
          <div className="mt-0.5 font-semibold tabular-nums">
            <Bias value={row.bias20} />
          </div>
        </div>
      </div>
    </Link>
  );
}

function seedFrom(
  initial: MaScreenerPayload | null,
): { data: MaScreenerPayload | null; fromCache: boolean } {
  if (initial?.rows?.length) return { data: initial, fromCache: false };
  if (typeof window === "undefined") return { data: null, fromCache: false };
  const cached = readClientCache<MaScreenerPayload>(CLIENT_CACHE_KEYS.ma);
  if (cached?.rows?.length) return { data: cached, fromCache: true };
  return { data: null, fromCache: false };
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
    void load(false);
  }, [load]);

  const filtered = useMemo(() => {
    const rows = data?.rows ?? [];
    if (filter === "ma5") return rows.filter((r) => r.above5);
    if (filter === "ma10") return rows.filter((r) => r.above10);
    if (filter === "ma20") return rows.filter((r) => r.above20);
    if (filter === "all3") return rows.filter((r) => r.aboveAll);
    return rows;
  }, [data, filter]);

  const summary = data?.counts ?? {
    ma5: 0,
    ma10: 0,
    ma20: 0,
    all3: 0,
    total: data?.rows?.length ?? 0,
  };

  const activeHint = FILTERS.find((f) => f.id === filter)?.hint ?? "";

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
          找出產業指數收盤站上五日、十日、二十日線的族群。點列可進產業 K 線。
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
            {!data?.rows?.length
              ? " 正在補建產業 K 線，請稍後按「重新掃描」。"
              : ""}
          </div>
        ) : (
          <>
            <div className="mt-6 grid gap-3 md:hidden">
              {filtered.map((row) => (
                <RowCard key={row.id} row={row} />
              ))}
            </div>

            <div className="mt-6 hidden overflow-hidden rounded-xl border border-border/50 bg-[var(--panel)]/70 md:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border/50 bg-muted/30 text-[11px] text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">產業</th>
                    <th className="px-3 py-3 font-medium">收盤</th>
                    <th className="px-3 py-3 font-medium">MA5</th>
                    <th className="px-3 py-3 font-medium">MA10</th>
                    <th className="px-3 py-3 font-medium">MA20</th>
                    <th className="px-3 py-3 font-medium">站上</th>
                    <th className="px-3 py-3 font-medium">乖離5</th>
                    <th className="px-3 py-3 font-medium">乖離10</th>
                    <th className="px-4 py-3 font-medium">乖離20</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-border/30 transition hover:bg-muted/30"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/sectors/${encodeURIComponent(row.id)}`}
                          className="font-medium hover:text-[var(--mk-anchor)]"
                        >
                          {row.name}
                        </Link>
                      </td>
                      <td className="px-3 py-3 tabular-nums text-muted-foreground">
                        {row.close.toFixed(2)}
                      </td>
                      <td className="px-3 py-3">
                        <Flag on={row.above5} label="上" />
                      </td>
                      <td className="px-3 py-3">
                        <Flag on={row.above10} label="上" />
                      </td>
                      <td className="px-3 py-3">
                        <Flag on={row.above20} label="上" />
                      </td>
                      <td className="px-3 py-3 tabular-nums text-muted-foreground">
                        {row.aboveCount}/3
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
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
