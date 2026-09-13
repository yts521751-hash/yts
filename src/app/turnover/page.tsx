"use client";

/** 台北現在幾分（自 00:00）；失敗回 -1 */
function taipeiMinsNow() {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
      weekday: "short",
    }).formatToParts(new Date());
    const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
    if (wd === "Sat" || wd === "Sun") return -1;
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    return h * 60 + m;
  } catch {
    return -1;
  }
}


import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { formatPct, formatYi, signedClass } from "@/lib/format";
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
  inSession: boolean;
  sessionNote: string;
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
  const [fromCache, setFromCache] = useState(false);
  const prevRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const cached = readClientCache<TurnoverSnapshot>(CLIENT_CACHE_KEYS.turnover);
    if (cached?.rows?.length) {
      setRows(cached.rows);
      setDate(cached.date || "");
      setUpdatedAt(cached.builtAt || "");
      setSource(cached.source || "client-cache");
      setInSession(Boolean(cached.inSession));
      setSessionNote(cached.sessionNote || "");
      prevRef.current = new Map(cached.rows.map((r) => [r.code, r.turnoverYi]));
      setFromCache(true);
      setLoading(false);
    }
  }, []);

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
      const sessionNow = Boolean(data.inSession);
      const changed = new Set<string>();
      let rowsChanged = prevRef.current.size !== next.length;
      for (const r of next) {
        const prev = prevRef.current.get(r.code);
        if (prev == null || prev !== r.turnoverYi) {
          if (prev != null && prev !== r.turnoverYi) changed.add(r.code);
          rowsChanged = true;
        }
      }
      // 休市且排行未變：只同步 inSession，不刷新時間戳／tick，避免畫面一直跳動
      const skipUiChurn =
        !sessionNow && !rowsChanged && prevRef.current.size > 0;
      setInSession(sessionNow);
      setSessionNote(String(data.sessionNote || ""));
      if (skipUiChurn) {
        setError(null);
        return;
      }
      prevRef.current = new Map(next.map((r) => [r.code, r.turnoverYi]));
      setRows(next);
      setDate(data.date || "");
      setUpdatedAt(data.builtAt || "");
      setSource(String(data.source || ""));
      setFromCache(false);
      if (sessionNow) setTick((n) => n + 1);
      writeClientCache<TurnoverSnapshot>(CLIENT_CACHE_KEYS.turnover, {
        rows: next,
        date: String(data.date || ""),
        builtAt: String(data.builtAt || ""),
        source: String(data.source || ""),
        inSession: sessionNow,
        sessionNote: String(data.sessionNote || ""),
      });
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

  // 僅盤中每 3 秒 live 更新；休市／週末維持上個交易日結果，不輪詢刷新
  useEffect(() => {
    if (!inSession) return;
    const t = setInterval(() => void load(true), 3000);
    return () => clearInterval(t);
  }, [inSession, load]);

  // 休市探測：接近開盤（08:50–09:10）每 10 秒並可 live 預熱，其餘 60 秒
  useEffect(() => {
    if (inSession) return;
    let timer: number | undefined;
    const schedule = () => {
      const mins = taipeiMinsNow();
      const nearOpen = mins >= 8 * 60 + 50 && mins < 9 * 60 + 10;
      void load(nearOpen);
      timer = window.setTimeout(schedule, nearOpen ? 10_000 : 60_000);
    };
    schedule();
    return () => {
      if (timer != null) window.clearTimeout(timer);
    };
  }, [inSession, load]);

  const metaLine = (
    <>
      {date ? `${date}` : ""}
      {inSession
        ? source === "live-refresh"
          ? " · 盤中即時"
          : " · 盤中讀取中"
        : " · 休市（上個交易日）"}
      {updatedAt
        ? ` · ${new Date(updatedAt).toLocaleTimeString("zh-TW", {
            hour12: false,
          })}`
        : ""}
      {inSession ? (
        <>
          <span className="ml-1.5 inline-block size-1.5 animate-pulse rounded-full bg-[var(--mk-up)] align-middle" />
          <span className="ml-1 tabular-nums opacity-70">#{tick}</span>
        </>
      ) : null}
    </>
  );

  return (
    <div className="relative min-h-full flex-1">
      <div
        className="studio-atmosphere pointer-events-none absolute inset-0"
        aria-hidden
      />
      <div className="relative z-10 mx-auto max-w-[1100px] px-3 py-5 sm:px-6 sm:py-8">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          回排行榜
        </Link>

        <div className="mt-3 flex flex-col gap-2 sm:mt-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight sm:text-3xl">
              成交金額排行 Top 50
            </h1>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground sm:mt-2">
              證交所／櫃買公開資料 · 盤中約每 3 秒更新，休市固定上個交易日
              {fromCache ? " · 已先顯示本機快取" : ""}
            </p>
          </div>
          <div className="text-[11px] leading-relaxed text-muted-foreground sm:text-right sm:text-xs">
            <p className="break-words">{metaLine}</p>
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
              {/* 手機：單欄卡片，避免寬表被裁切 */}
              <ul className="divide-y divide-border/40 sm:hidden">
                {rows.map((r) => (
                  <li
                    key={r.code}
                    className={cn(
                      "flex items-start gap-3 px-3 py-3 transition-colors",
                      flashCodes.has(r.code) && "bg-[var(--mk-up)]/10",
                    )}
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
                        {formatYi(r.turnoverYi)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>

              {/* 平板／桌機：完整表格 */}
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
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
