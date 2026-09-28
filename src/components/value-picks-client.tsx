"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  RefreshCw,
} from "lucide-react";
import {
  CLIENT_CACHE_KEYS,
  readClientCache,
  writeClientCache,
} from "@/lib/client-cache";
import { formatPct, formatYi, signedClass } from "@/lib/format";
import type { ValuePickRow, ValuePicksPayload } from "@/lib/value-picks";
import { cn } from "@/lib/utils";

type SortKey = "epsYoy" | "forwardPe" | "dayAmt" | "close" | "changePct";

function sortValue(row: ValuePickRow, key: SortKey) {
  if (key === "forwardPe") return row.forwardPe;
  if (key === "dayAmt") return row.dayAmt;
  if (key === "close") return row.close;
  if (key === "changePct") return row.changePct;
  return row.epsYoy;
}

function seedFrom(initial: ValuePicksPayload | null) {
  if (initial?.rows?.length) return { data: initial, fromCache: false };
  if (typeof window === "undefined") return { data: null, fromCache: false };
  const cached = readClientCache<ValuePicksPayload>(CLIENT_CACHE_KEYS.value);
  if (cached?.rows?.length) return { data: cached, fromCache: true };
  return { data: null, fromCache: false };
}

export function ValuePicksClient({
  initial,
}: {
  initial: ValuePicksPayload | null;
}) {
  const seeded = seedFrom(initial);
  const [data, setData] = useState<ValuePicksPayload | null>(() => seeded.data);
  const [loading, setLoading] = useState(() => !seeded.data?.rows?.length);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("epsYoy");
  const [asc, setAsc] = useState(false);
  const [fromCache, setFromCache] = useState(() => seeded.fromCache);

  const load = useCallback(async (force = false) => {
    setError(null);
    if (force) setRefreshing(true);
    else if (!data?.rows?.length) setLoading(true);
    try {
      const res = await fetch(`/api/value${force ? "?force=1" : ""}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as ValuePicksPayload & {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || json.ok === false) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setData(json);
      setFromCache(false);
      writeClientCache(CLIENT_CACHE_KEYS.value, json);
    } catch (e) {
      if (!data?.rows?.length) {
        setError(e instanceof Error ? e.message : "載入失敗");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [data?.rows?.length]);

  useEffect(() => {
    if (seeded.data?.rows?.length) {
      setLoading(false);
      return;
    }
    void load(false);
    // 僅冷啟動拉一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => {
    const list = [...(data?.rows ?? [])];
    list.sort((a, b) => {
      const d = sortValue(a, sortKey) - sortValue(b, sortKey);
      if (d !== 0) return asc ? d : -d;
      return b.epsYoy - a.epsYoy;
    });
    return list;
  }, [data?.rows, sortKey, asc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setAsc((v) => !v);
    else {
      setSortKey(key);
      setAsc(key === "forwardPe");
    }
  };

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) {
      return <ArrowUpDown className="ml-0.5 inline size-3 opacity-40" />;
    }
    return asc ? (
      <ArrowUp className="ml-0.5 inline size-3" />
    ) : (
      <ArrowDown className="ml-0.5 inline size-3" />
    );
  };

  return (
    <div className="relative min-h-full flex-1 pb-20 md:pb-6">
      <div
        className="studio-atmosphere pointer-events-none absolute inset-0"
        aria-hidden
      />
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
              className={cn(
                "size-3.5",
                (loading || refreshing) && "animate-spin",
              )}
            />
            重新篩選
          </button>
        </div>

        <h1 className="mt-4 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
          價值選股
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          篩選明年 EPS 年增率（多家法人預估中位數）大於{" "}
          {data?.criteria.minEpsYoy ?? 50}%，前瞻本益比（股價 ÷ 明年 EPS
          中位數）低於 {data?.criteria.maxForwardPe ?? 35}，且當日一般成交金額
          達 {data?.criteria.minDayAmtYi ?? 10} 億以上的個股。
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          EPS 來源：Cnyes／FactSet 法人共識中位數
          {data?.date ? ` · 行情日 ${data.date}` : ""}
          {data?.scanned != null ? ` · 掃描 ${data.scanned} 檔` : ""}
          {data?.builtAt
            ? ` · 更新 ${new Date(data.builtAt).toLocaleString("zh-TW", { hour12: false })}`
            : ""}
          {fromCache ? " · 本機快取" : ""}
        </p>

        {loading && !rows.length ? (
          <p className="mt-10 text-center text-sm text-muted-foreground">
            正在篩選符合條件的個股…
          </p>
        ) : error && !rows.length ? (
          <div className="mt-10 text-center">
            <p className="text-sm text-[var(--mk-ebb)]">{error}</p>
            <button
              type="button"
              onClick={() => void load(true)}
              className="mt-3 border border-border px-3 py-1.5 text-xs transition hover:bg-muted/50"
            >
              再試一次
            </button>
          </div>
        ) : !rows.length ? (
          <p className="mt-10 text-center text-sm text-muted-foreground">
            目前沒有同時符合「明年 EPS YoY &gt; 50%」、「前瞻本益比 &lt; 35」與「成交 ≥ 10 億」的標的。
          </p>
        ) : (
          <>
            <p className="mt-5 text-xs text-muted-foreground">
              共 {rows.length} 檔 · 點欄位可排序
            </p>

            {/* 手機卡片 */}
            <ul className="mt-3 space-y-2 md:hidden">
              {rows.map((r) => (
                <li
                  key={r.code}
                  className="rounded-xl border border-border/50 bg-[var(--panel)]/70 p-3.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium">
                        <span className="tabular-nums text-muted-foreground">
                          {r.rank}.
                        </span>{" "}
                        {r.name}
                      </div>
                      <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                        {r.code} · {r.close.toFixed(r.close >= 100 ? 0 : 2)}
                        <span className={cn("ml-1.5", signedClass(r.changePct))}>
                          {formatPct(r.changePct)}
                        </span>
                      </div>
                    </div>
                    <div className="text-right text-[11px]">
                      <div className="text-muted-foreground">EPS YoY</div>
                      <div className="font-semibold tabular-nums text-[var(--mk-up)]">
                        +{r.epsYoy.toFixed(1)}%
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                    <div className="rounded-lg bg-muted/40 px-2 py-1.5">
                      <div className="text-muted-foreground">前瞻本益比</div>
                      <div className="mt-0.5 font-semibold tabular-nums">
                        {r.forwardPe.toFixed(1)}
                      </div>
                    </div>
                    <div className="rounded-lg bg-muted/40 px-2 py-1.5">
                      <div className="text-muted-foreground">明年 EPS</div>
                      <div className="mt-0.5 font-semibold tabular-nums">
                        {r.nextYearEps.toFixed(2)}
                      </div>
                    </div>
                    <div className="rounded-lg bg-muted/40 px-2 py-1.5">
                      <div className="text-muted-foreground">成交</div>
                      <div className="mt-0.5 font-semibold tabular-nums">
                        {formatYi(r.dayAmt)}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            {/* 桌面表格 */}
            <div className="mt-3 hidden overflow-x-auto rounded-xl border border-border/50 bg-[var(--panel)]/70 md:block">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border/50 text-left text-[11px] text-muted-foreground">
                    <th className="px-3 py-2.5 font-medium">#</th>
                    <th className="px-3 py-2.5 font-medium">代號／名稱</th>
                    <th className="px-3 py-2.5 text-right font-medium">
                      <button type="button" onClick={() => toggleSort("close")}>
                        股價
                        <SortIcon k="close" />
                      </button>
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium">
                      <button
                        type="button"
                        onClick={() => toggleSort("changePct")}
                      >
                        漲跌
                        <SortIcon k="changePct" />
                      </button>
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium">
                      <button type="button" onClick={() => toggleSort("epsYoy")}>
                        明年 EPS YoY
                        <SortIcon k="epsYoy" />
                      </button>
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium">
                      明年／今年 EPS
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium">
                      <button
                        type="button"
                        onClick={() => toggleSort("forwardPe")}
                      >
                        前瞻本益比
                        <SortIcon k="forwardPe" />
                      </button>
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium">
                      <button type="button" onClick={() => toggleSort("dayAmt")}>
                        成交
                        <SortIcon k="dayAmt" />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.code}
                      className="border-t border-border/40 transition hover:bg-muted/30"
                    >
                      <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                        {r.rank}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium">{r.name}</div>
                        <div className="text-[11px] tabular-nums text-muted-foreground">
                          {r.code}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {r.close.toFixed(r.close >= 100 ? 0 : 2)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2.5 text-right tabular-nums",
                          signedClass(r.changePct),
                        )}
                      >
                        {formatPct(r.changePct)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-[var(--mk-up)]">
                        +{r.epsYoy.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                        {r.nextYearEps.toFixed(2)} / {r.baseEps.toFixed(2)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                        {r.forwardPe.toFixed(1)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {formatYi(r.dayAmt)}
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
