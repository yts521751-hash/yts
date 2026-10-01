"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { formatPct, formatUsTurnoverYi, signedClass } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MarketSwitch } from "@/components/market-switch";
import { UsStockName } from "@/components/us-stock-name";
import { COLUMN_TIPS, ColumnTip } from "@/components/column-tip";

type Row = {
  rank: number;
  code: string;
  name: string;
  nameEn?: string;
  nameZh?: string;
  dayAmt: number;
  changePct: number;
  close: number;
  volume?: number;
  volumeSource?: string;
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
    <div className="relative min-h-full flex-1">
      <div
        className="studio-atmosphere pointer-events-none absolute inset-0"
        aria-hidden
      />
      <div className="relative z-10 mx-auto max-w-[1100px] px-3 py-5 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/us"
            className="inline-flex min-h-10 items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            回美股資金流
          </Link>
          <div className="flex items-center gap-2">
            <MarketSwitch />
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={loading || refreshing}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-border/50 bg-muted/30 px-3 py-2 text-xs font-medium transition hover:bg-muted/60 disabled:opacity-50"
            >
              <RefreshCw
                className={cn(
                  "size-3.5",
                  (loading || refreshing) && "animate-spin",
                )}
              />
              重新整理
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-2 sm:mt-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight sm:text-3xl">
              美股成交排行 Top 50
            </h1>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground sm:mt-2">
              {basis ||
                "成值＝收盤價×Nasdaq成交股數÷1e8（單位：億美元；失敗時回退 Yahoo volume）"}
            </p>
          </div>
          <div className="text-[11px] leading-relaxed text-muted-foreground sm:text-right sm:text-xs">
            <p className="break-words">{date ? `資料日 ${date}` : ""}</p>
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
              {/* 手機：堆疊列／卡片，避免橫向表格 */}
              <ul className="divide-y divide-border/40 sm:hidden">
                {rows.map((r) => (
                  <li key={r.code} className="px-3 py-3">
                    <div className="flex w-full items-start gap-3">
                      <span className="w-6 shrink-0 pt-0.5 text-center text-xs tabular-nums text-muted-foreground">
                        {r.rank}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium tabular-nums">{r.code}</p>
                        <UsStockName
                          code={r.code}
                          nameEn={r.nameEn}
                          nameZh={r.nameZh}
                          name={r.name}
                          variant="stack"
                          className="mt-0.5"
                        />
                        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
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
                      <div className="shrink-0 pt-0.5 text-right">
                        <p className="text-[10px] text-muted-foreground">成值</p>
                        <p className="text-sm font-semibold tabular-nums">
                          {formatUsTurnoverYi(r.dayAmt)}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              {/* 桌面：表格（與台股成交排行一致） */}
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="sticky top-0 z-10 border-b border-border/50 bg-[var(--panel)] text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-3 font-medium">#</th>
                      <th className="px-3 py-3 font-medium">代號</th>
                      <th className="px-3 py-3 font-medium">名稱</th>
                      <th className="px-3 py-3 text-right font-medium">
                        <ColumnTip tip={COLUMN_TIPS.amt}>成值</ColumnTip>
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
                        <td className="px-3 py-2.5">
                          <UsStockName
                            code={r.code}
                            nameEn={r.nameEn}
                            nameZh={r.nameZh}
                            name={r.name}
                            variant="stack"
                          />
                        </td>
                        <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                          {formatUsTurnoverYi(r.dayAmt)}
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
