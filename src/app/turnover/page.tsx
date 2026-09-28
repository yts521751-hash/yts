"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { formatPct, formatTurnoverYi, signedClass } from "@/lib/format";
import { cn } from "@/lib/utils";
import { COLUMN_TIPS, ColumnTip } from "@/components/column-tip";
import {
  CLIENT_CACHE_KEYS,
  readClientCache,
  writeClientCache,
} from "@/lib/client-cache";

type Row = {
  rank: number;
  code: string;
  name: string;
  turnoverYi: number;
  changePct: number;
  close: number;
};

type TurnoverSnapshot = {
  rows: Row[];
  date: string;
  builtAt: string;
  source: string;
  sessionNote: string;
  amountBasis?: string;
};

export default function TurnoverPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [date, setDate] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");
  const [sessionNote, setSessionNote] = useState("");
  const [amountBasis, setAmountBasis] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fromCache, setFromCache] = useState(false);

  useEffect(() => {
    const cached = readClientCache<TurnoverSnapshot>(CLIENT_CACHE_KEYS.turnover);
    if (cached?.rows?.length) {
      setRows(cached.rows);
      setDate(cached.date || "");
      setUpdatedAt(cached.builtAt || "");
      setSessionNote(cached.sessionNote || "");
      setAmountBasis(cached.amountBasis || "");
      setFromCache(true);
      setLoading(false);
    }
  }, []);

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    try {
      const res = await fetch(
        `/api/turnover?limit=50${force ? "&force=1" : ""}`,
        { cache: "no-store" },
      );
      const data = await res.json();
      if (!data.ok || !data.rows?.length) {
        setError(data.error || "無法載入成交排行");
        return;
      }
      const next = data.rows as Row[];
      setRows(next);
      setDate(String(data.date || ""));
      setUpdatedAt(String(data.builtAt || ""));
      setSessionNote(String(data.sessionNote || ""));
      setAmountBasis(String(data.amountBasis || ""));
      setFromCache(false);
      writeClientCache<TurnoverSnapshot>(CLIENT_CACHE_KEYS.turnover, {
        rows: next,
        date: String(data.date || ""),
        builtAt: String(data.builtAt || ""),
        source: String(data.source || ""),
        sessionNote: String(data.sessionNote || ""),
        amountBasis: String(data.amountBasis || ""),
      });
      setError(null);
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

  return (
    <div className="relative min-h-full flex-1">
      <div
        className="studio-atmosphere pointer-events-none absolute inset-0"
        aria-hidden
      />
      <div className="relative z-10 mx-auto max-w-[1100px] px-3 py-5 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            回排行榜
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
            重新整理
          </button>
        </div>

        <div className="mt-3 flex flex-col gap-2 sm:mt-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight sm:text-3xl">
              成交金額排行 Top 50
            </h1>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground sm:mt-2">
              {amountBasis ||
                "一般成交金額（不含盤後定價／零股／鉅額）· 每日收盤後更新"}
              {fromCache ? " · 已先顯示本機快取" : ""}
            </p>
          </div>
          <div className="text-[11px] leading-relaxed text-muted-foreground sm:text-right sm:text-xs">
            <p className="break-words">
              {date ? `${date}` : ""}
              {" · 日終快照"}
              {updatedAt
                ? ` · ${new Date(updatedAt).toLocaleString("zh-TW", {
                    hour12: false,
                  })}`
                : ""}
            </p>
            {sessionNote ? (
              <p className="mt-1 max-w-prose leading-relaxed sm:ml-auto sm:max-w-sm">
                {sessionNote}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-border/60 bg-[var(--panel)]/80 backdrop-blur-sm sm:mt-6">
          {loading ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              載入中…
            </p>
          ) : error ? (
            <p className="p-8 text-center text-sm text-amber-800 dark:text-amber-100">
              {error}
            </p>
          ) : (
            <>
              <ul className="divide-y divide-border/40 sm:hidden">
                {rows.map((r) => (
                  <li
                    key={r.code}
                    className="flex items-start gap-3 px-3 py-3"
                  >
                    <span className="w-6 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">
                      {r.rank}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="font-medium tabular-nums">
                          {r.code}
                        </span>
                        <span className="truncate text-sm">{r.name}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span>
                          漲跌{" "}
                          <span
                            className={cn(
                              "font-medium tabular-nums",
                              signedClass(r.changePct),
                            )}
                          >
                            {formatPct(r.changePct)}
                          </span>
                        </span>
                        <span>
                          收盤{" "}
                          <span className="tabular-nums text-foreground/80">
                            {r.close.toFixed(2)}
                          </span>
                        </span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[10px] text-muted-foreground">成交</p>
                      <p className="text-sm font-semibold tabular-nums">
                        {formatTurnoverYi(r.turnoverYi)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="border-b border-border/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-3 font-medium">#</th>
                      <th className="px-3 py-3 font-medium">代號</th>
                      <th className="px-3 py-3 font-medium">名稱</th>
                      <th className="px-3 py-3 text-right font-medium">
                        <ColumnTip tip={COLUMN_TIPS.amt}>成交金額</ColumnTip>
                      </th>
                      <th className="px-3 py-3 text-right font-medium">
                        <ColumnTip tip={COLUMN_TIPS.changePct}>漲跌</ColumnTip>
                      </th>
                      <th className="px-3 py-3 text-right font-medium">
                        <ColumnTip tip={COLUMN_TIPS.close}>收盤</ColumnTip>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.code}
                        className="border-b border-border/30 transition hover:bg-muted/30"
                      >
                        <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                          {r.rank}
                        </td>
                        <td className="px-3 py-2.5 font-medium tabular-nums">
                          {r.code}
                        </td>
                        <td className="px-3 py-2.5">{r.name}</td>
                        <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                          {formatTurnoverYi(r.turnoverYi)}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2.5 text-right tabular-nums",
                            signedClass(r.changePct),
                          )}
                        >
                          {formatPct(r.changePct)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                          {r.close.toFixed(2)}
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
    </div>
  );
}
