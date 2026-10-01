"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { formatPct, formatTurnoverYi, signedClass } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MarketSwitch } from "@/components/market-switch";

type Row = {
  rank: number;
  code: string;
  name: string;
  dayAmt: number;
  changePct: number;
  close: number;
  volume?: number;
};

export default function UsTurnoverPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [date, setDate] = useState("");
  const [basis, setBasis] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/us/turnover?limit=50${force ? "&force=1" : ""}`,
        { cache: "no-store" },
      );
      const json = await res.json();
      if (!json.ok || !json.rows?.length) {
        throw new Error(json.error || "尚無美股成交排行，請先同步");
      }
      setRows(json.rows);
      setDate(json.date || "");
      setBasis(json.amountBasis || "");
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
    <div className="relative min-h-full flex-1 pb-20 md:pb-6">
      <div className="studio-atmosphere pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative z-10 mx-auto max-w-[1100px] px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <Link
            href="/us"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
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

        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight">
          美股成交排行
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {date ? `資料日 ${date} · ` : ""}
          {basis || "正規盤成交金額（億美元）"}
        </p>

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
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">代號</th>
                  <th className="px-3 py-2">名稱</th>
                  <th className="px-3 py-2 text-right">成交（億美元）</th>
                  <th className="px-3 py-2 text-right">漲跌</th>
                  <th className="px-3 py-2 text-right">收盤</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r.code}>
                    <tr className="border-t border-border/60">
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">
                        {r.rank}
                      </td>
                      <td className="px-3 py-2 font-mono font-medium">{r.code}</td>
                      <td className="px-3 py-2">{r.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatTurnoverYi(r.dayAmt)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right tabular-nums",
                          signedClass(r.changePct),
                        )}
                      >
                        {formatPct(r.changePct)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.close.toFixed(2)}
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
