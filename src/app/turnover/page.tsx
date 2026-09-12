"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { formatPct, formatYi, signedClass } from "@/lib/format";
import { cn } from "@/lib/utils";
import { COLUMN_TIPS, ColumnTip } from "@/components/column-tip";

type Row = {
  rank: number;
  code: string;
  name: string;
  turnoverYi: number;
  changePct: number;
  close: number;
};

export default function TurnoverPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [date, setDate] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (live = false) => {
    try {
      const res = await fetch(`/api/turnover?limit=50${live ? "&live=1" : ""}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!data.ok || !data.rows?.length) {
        setError(data.error || "無法載入成交排行");
        return;
      }
      setRows(data.rows);
      setDate(data.date || "");
      setUpdatedAt(data.builtAt || "");
      setSource(String(data.source || ""));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  // 盤中每 5 秒刷新；盤後仍 15 秒讀快取（排名通常不變）
  useEffect(() => {
    const t = setInterval(() => void load(true), 5000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="relative min-h-full flex-1">
      <div className="studio-atmosphere pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative z-10 mx-auto max-w-[1100px] px-4 py-8 sm:px-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          回排行榜
        </Link>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-2">
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
            成交金額排行 Top 50
          </h1>
        <p className="mt-2 text-[11px] text-muted-foreground">資料來源：臺灣證券交易所、證券櫃檯買賣中心公開資料</p>
          <p className="text-xs text-muted-foreground">
            {date ? `${date}` : ""}
            {source === "live-refresh" ? " · 盤中約 5 秒刷新" : " · 約 5 秒更新"}
            {updatedAt
              ? ` · ${new Date(updatedAt).toLocaleTimeString("zh-TW", { hour12: false })}`
              : ""}
          </p>
        </div>

        <div className="mt-6 overflow-x-auto rounded-2xl border border-border/60 bg-[var(--panel)]/80 backdrop-blur-sm">
          {loading ? (
            <p className="p-8 text-center text-sm text-muted-foreground">載入中…</p>
          ) : error ? (
            <p className="p-8 text-center text-sm text-amber-800 dark:text-amber-100">{error}</p>
          ) : (
            <table className="w-full min-w-[640px] text-left text-sm">
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
                    <td className="px-3 py-2.5 font-medium tabular-nums">{r.code}</td>
                    <td className="px-3 py-2.5">{r.name}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium transition-all duration-300">
                      {formatYi(r.turnoverYi)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2.5 text-right tabular-nums transition-colors duration-300",
                        signedClass(r.changePct),
                      )}
                    >
                      {formatPct(r.changePct)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground transition-all duration-300">
                      {r.close.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
