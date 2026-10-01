"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { MarketSwitch } from "@/components/market-switch";
import type { MaScreenerRow } from "@/lib/ma-screener-types";
import { cn } from "@/lib/utils";

export default function UsMaPage() {
  const [rows, setRows] = useState<MaScreenerRow[]>([]);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "all2" | "ma5" | "ma10">("all2");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/us/ma-screener${force ? "?force=1" : ""}`,
        { cache: "no-store" },
      );
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "均線掃描失敗");
      setRows(json.rows || []);
      setAsOf(json.asOf || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入失敗");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const visible = useMemo(() => {
    if (filter === "all2") return rows.filter((r) => r.aboveAll);
    if (filter === "ma5") return rows.filter((r) => r.above5);
    if (filter === "ma10") return rows.filter((r) => r.above10);
    return rows;
  }, [rows, filter]);

  return (
    <div className="relative min-h-full flex-1 pb-20 md:pb-6">
      <div className="studio-atmosphere pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative z-10 mx-auto max-w-[1100px] px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <Link
            href="/us"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            回美股資金流
          </Link>
          <div className="flex items-center gap-2">
            <MarketSwitch />
            <button
              type="button"
              onClick={() => void load(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-xs font-medium"
            >
              <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
              更新
            </button>
          </div>
        </div>

        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold">
          美股產業均線掃描
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {asOf ? `資料日 ${asOf} · ` : ""}
          合成產業指數站上 MA5／MA10
        </p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {(
            [
              ["all2", "兩線之上"],
              ["ma5", "站上五日"],
              ["ma10", "站上十日"],
              ["all", "全部"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={cn(
                "border px-2.5 py-1 text-xs",
                filter === id
                  ? "border-[var(--mk-anchor)] bg-[var(--mk-anchor)] text-white"
                  : "border-border bg-muted/30 text-muted-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="py-16 text-center text-sm text-muted-foreground">載入中…</p>
        ) : error ? (
          <p className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-6 text-sm">
            {error}
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto border border-border">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-muted/40 font-mono text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">產業</th>
                  <th className="px-3 py-2 text-right">收盤</th>
                  <th className="px-3 py-2 text-right">MA5</th>
                  <th className="px-3 py-2 text-right">MA10</th>
                  <th className="px-3 py-2 text-right">5日流</th>
                  <th className="px-3 py-2">K線</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id} className="border-t border-border/60">
                    <td className="px-3 py-2 font-medium">{r.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.close.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.ma5?.toFixed(2) ?? "—"}
                      {r.above5 ? " ✓" : ""}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.ma10?.toFixed(2) ?? "—"}
                      {r.above10 ? " ✓" : ""}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.flow5.toFixed(1)}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/us/sectors/${encodeURIComponent(r.id)}?from=ma`}
                        className="text-[var(--mk-anchor)] underline-offset-2 hover:underline"
                      >
                        開啟
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visible.length ? (
              <p className="px-3 py-6 text-sm text-muted-foreground">
                此篩選無標的。請先同步美股或改「全部」。
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
