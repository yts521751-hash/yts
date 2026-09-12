"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { formatPct, formatYi, signedClass } from "@/lib/format";
import { cn } from "@/lib/utils";

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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/turnover?limit=100", { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        if (!data.ok || !data.rows?.length) {
          setError(data.error || "無法載入成交排行");
          setRows([]);
        } else {
          setRows(data.rows);
          setDate(data.date || "");
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "載入失敗");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="relative min-h-full flex-1">
      <div className="tide-atmosphere pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative z-10 mx-auto max-w-[1100px] px-4 py-8 sm:px-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          回資金流排行
        </Link>
        <h1 className="mt-4 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
          當日成交金額排行
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          單純依上市＋上櫃個股當日成交金額排序（億元），不含資金流方向權重。
          {date ? ` 資料日 ${date}` : ""}
        </p>

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
                  <th className="px-3 py-3 text-right font-medium">成交金額</th>
                  <th className="px-3 py-3 text-right font-medium">漲跌</th>
                  <th className="px-3 py-3 text-right font-medium">收盤</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.code}
                    className="border-b border-border/30 transition hover:bg-muted/30"
                  >
                    <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{r.rank}</td>
                    <td className="px-3 py-2.5 font-medium tabular-nums">{r.code}</td>
                    <td className="px-3 py-2.5">{r.name}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                      {formatYi(r.turnoverYi)}
                    </td>
                    <td className={cn("px-3 py-2.5 text-right tabular-nums", signedClass(r.changePct))}>
                      {formatPct(r.changePct)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
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
