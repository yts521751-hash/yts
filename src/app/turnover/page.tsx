"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const [inSession, setInSession] = useState(false);
  const [sessionNote, setSessionNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [flashCodes, setFlashCodes] = useState<Set<string>>(new Set());
  const prevRef = useRef<Map<string, number>>(new Map());

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
      const next = data.rows as Row[];
      const changed = new Set<string>();
      for (const r of next) {
        const prev = prevRef.current.get(r.code);
        if (prev != null && prev !== r.turnoverYi) changed.add(r.code);
      }
      prevRef.current = new Map(next.map((r) => [r.code, r.turnoverYi]));
      setRows(next);
      setDate(data.date || "");
      setUpdatedAt(data.builtAt || "");
      setSource(String(data.source || ""));
      setInSession(Boolean(data.inSession));
      setSessionNote(String(data.sessionNote || ""));
      setTick((n) => n + 1);
      if (changed.size) {
        setFlashCodes(changed);
        window.setTimeout(() => setFlashCodes(new Set()), 900);
      }
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

  // 固定每 3 秒輪詢：盤中 live=1 重抓公開行情；休市仍刷新時間戳，週一開盤自動切即時
  useEffect(() => {
    const t = setInterval(() => void load(true), 3000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="relative min-h-full flex-1">
      <div
        className="studio-atmosphere pointer-events-none absolute inset-0"
        aria-hidden
      />
      <div className="relative z-10 mx-auto max-w-[1100px] px-4 py-8 sm:px-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          回排行榜
        </Link>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
              成交金額排行 Top 50
            </h1>
            <p className="mt-2 text-[11px] text-muted-foreground">
              資料來源：臺灣證券交易所、證券櫃檯買賣中心公開資料（非寫死）
            </p>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <p>
              {date ? `${date}` : ""}
              {inSession
                ? source === "live-refresh"
                  ? " · 盤中即時"
                  : " · 盤中讀取中"
                : " · 休市快取"}
              {updatedAt
                ? ` · ${new Date(updatedAt).toLocaleTimeString("zh-TW", {
                    hour12: false,
                  })}`
                : ""}
              <span className="ml-1.5 inline-block size-1.5 animate-pulse rounded-full bg-[var(--mk-up)] align-middle" />
              <span className="ml-1 tabular-nums opacity-70">#{tick}</span>
            </p>
            {sessionNote ? (
              <p className="mt-1 max-w-sm text-[11px] leading-relaxed">
                {sessionNote}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-6 overflow-x-auto rounded-2xl border border-border/60 bg-[var(--panel)]/80 backdrop-blur-sm">
          {loading ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              載入中…
            </p>
          ) : error ? (
            <p className="p-8 text-center text-sm text-amber-800 dark:text-amber-100">
              {error}
            </p>
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
                    className={cn(
                      "border-b border-border/30 transition hover:bg-muted/30",
                      flashCodes.has(r.code) && "bg-[var(--mk-up)]/10",
                    )}
                  >
                    <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                      {r.rank}
                    </td>
                    <td className="px-3 py-2.5 font-medium tabular-nums">
                      {r.code}
                    </td>
                    <td className="px-3 py-2.5">{r.name}</td>
                    <td className="px-3 py-2.5 text-right font-medium tabular-nums transition-all duration-300">
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
