"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { MarketSwitch } from "@/components/market-switch";
import { formatPct, signedClass } from "@/lib/format";
import { cn } from "@/lib/utils";

type Row = {
  rank: number;
  code: string;
  name: string;
  close: number;
  changePct: number;
  dayAmt: number;
  nextYearEps: number;
  baseEps: number;
  epsYoy: number;
  forwardPe: number;
  revenueYoy?: number | null;
};

export default function UsValuePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [emptyReason, setEmptyReason] = useState<string | null>(null);
  const [criteria, setCriteria] = useState<{
    minEpsYoy?: number;
    maxForwardPe?: number;
    minDayAmtYi?: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(`/api/us/value${force ? "?force=1" : ""}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "價值選股載入失敗");
      setRows(json.rows || []);
      setNote(json.note || "");
      setDate(json.date || "");
      setEmptyReason(json.emptyReason || null);
      setCriteria(json.criteria || null);
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

  const criteriaLabel = criteria
    ? `EPS YoY > ${criteria.minEpsYoy}%、前瞻 PE < ${criteria.maxForwardPe}、成交 ≥ ${criteria.minDayAmtYi} 億美元`
    : "EPS YoY > 25%、前瞻 PE < 40、成交 ≥ 0.5 億美元";

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
              重算
            </button>
          </div>
        </div>

        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold">
          美股價值選股
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {date ? `資料日 ${date} · ` : ""}
          {criteriaLabel}
        </p>
        {note ? (
          <p className="mt-2 text-[11px] text-muted-foreground">{note}</p>
        ) : null}

        {loading ? (
          <p className="py-16 text-center text-sm text-muted-foreground">載入中…</p>
        ) : error ? (
          <p className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-6 text-sm">
            {error}
          </p>
        ) : rows.length === 0 ? (
          <p className="mt-6 rounded-2xl border border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
            {emptyReason ||
              "目前沒有通過篩選的標的。可先同步美股資料後再重算。"}
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto border border-border">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-muted/40 font-mono text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">代號</th>
                  <th className="px-3 py-2">名稱</th>
                  <th className="px-3 py-2 text-right">EPS YoY</th>
                  <th className="px-3 py-2 text-right">前瞻 PE</th>
                  <th className="px-3 py-2 text-right">成交億$</th>
                  <th className="px-3 py-2 text-right">漲跌</th>
                  <th className="px-3 py-2 text-right">季營收YoY</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.code} className="border-t border-border/60">
                    <td className="px-3 py-2 text-muted-foreground">{r.rank}</td>
                    <td className="px-3 py-2 font-mono font-medium">{r.code}</td>
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[var(--mk-up)]">
                      {formatPct(r.epsYoy, 1)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.forwardPe.toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.dayAmt.toFixed(1)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right tabular-nums",
                        signedClass(r.changePct),
                      )}
                    >
                      {formatPct(r.changePct)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {r.revenueYoy != null ? formatPct(r.revenueYoy, 1) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
