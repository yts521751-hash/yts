"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { formatPct, formatTurnoverYi, signedClass } from "@/lib/format";
import { cn } from "@/lib/utils";
import { COLUMN_TIPS, ColumnTip } from "@/components/column-tip";
import {
  CLIENT_CACHE_KEYS,
  readClientCache,
  writeClientCache,
} from "@/lib/client-cache";
import { FundMetricsGrid } from "@/components/fund-metrics-grid";
import { AppShell } from "@/components/app-shell";
import { Panel } from "@/components/ui/panel";
import { ActionButton } from "@/components/ui/action-button";
import { Amount } from "@/components/ui/amount";
import { RankSlot } from "@/components/ui/chip";
import { ErrorState, LoadingState } from "@/components/ui/states";

type Row = {
  rank: number;
  code: string;
  name: string;
  turnoverYi: number;
  changePct: number;
  close: number;
  forwardPe?: number | null;
  nextYearEps?: number | null;
  baseEps?: number | null;
  epsYoy?: number | null;
  epsSource?: string | null;
};

type TurnoverSnapshot = {
  rows: Row[];
  date: string;
  builtAt: string;
  source: string;
  sessionNote: string;
  amountBasis?: string;
};

function hasFund(r: Row) {
  return (
    r.forwardPe != null ||
    r.nextYearEps != null ||
    r.epsYoy != null ||
    r.baseEps != null
  );
}

const NO_FUND_HINT = "尚無基本面資料（同步日終後會批次補上）";

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
  const [expanded, setExpanded] = useState<string | null>(null);

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

  const toggle = (code: string) => {
    setExpanded((cur) => (cur === code ? null : code));
  };

  return (
    <AppShell
      market="tw"
      width="default"
      back={{ href: "/", label: "回資金流" }}
      eyebrow="TURNOVER TOP 50"
      title="成交金額排行"
      description={
        amountBasis ||
        "一般成交金額（不含盤後定價／零股／鉅額），每日收盤後更新。點任一列可展開前瞻本益比與明年 EPS。"
      }
      meta={
        <>
          {date ? `資料日 ${date} · 日終快照` : "日終快照"}
          {updatedAt
            ? ` · 更新 ${new Date(updatedAt).toLocaleString("zh-TW", { hour12: false })}`
            : ""}
          {fromCache ? " · 已先顯示本機快取" : ""}
          {sessionNote ? ` · ${sessionNote}` : ""}
        </>
      }
      actions={
        <ActionButton
          onClick={() => void load(true)}
          disabled={loading || refreshing}
        >
          <RefreshCw
            className={cn("size-3.5", (loading || refreshing) && "animate-spin")}
            aria-hidden
          />
          重新整理
        </ActionButton>
      }
    >
      <Panel className="overflow-hidden">
        {loading && !rows.length ? (
          <LoadingState label="載入成交排行…" />
        ) : error && !rows.length ? (
          <ErrorState
            description={error}
            action={
              <ActionButton size="sm" onClick={() => void load(true)}>
                再試一次
              </ActionButton>
            }
          />
        ) : (
          <>
            {/* 手機：堆疊列 */}
            <ul className="divide-y divide-line sm:hidden">
              {rows.map((r) => {
                const open = expanded === r.code;
                return (
                  <li key={r.code}>
                    <button
                      type="button"
                      onClick={() => toggle(r.code)}
                      aria-expanded={open}
                      className="flex min-h-[4.25rem] w-full items-center gap-3 px-3 py-3 text-left"
                    >
                      <RankSlot rank={r.rank} emphasis />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="num text-[0.9375rem] font-semibold">
                            {r.code}
                          </span>
                          <span className="truncate text-sm">{r.name}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground">
                          <span>
                            漲跌{" "}
                            <span
                              className={cn(
                                "num font-medium",
                                signedClass(r.changePct),
                              )}
                            >
                              {formatPct(r.changePct)}
                            </span>
                          </span>
                          <span>
                            收盤{" "}
                            <span className="num text-foreground/80">
                              {r.close.toFixed(2)}
                            </span>
                          </span>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="t-kicker">成交</p>
                        <Amount
                          text={formatTurnoverYi(r.turnoverYi)}
                          className="text-[0.9375rem] font-semibold"
                        />
                      </div>
                      <ChevronDown
                        className={cn(
                          "size-4 shrink-0 text-muted-foreground transition-transform",
                          open && "rotate-180",
                        )}
                        aria-hidden
                      />
                    </button>
                    {open ? (
                      <div className="bg-sunken px-3 pt-1 pb-3">
                        {hasFund(r) ? (
                          <FundMetricsGrid
                            forwardPe={r.forwardPe}
                            nextYearEps={r.nextYearEps}
                            baseEps={r.baseEps}
                            epsYoy={r.epsYoy}
                          />
                        ) : (
                          <p className="t-meta">{NO_FUND_HINT}</p>
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            {/* 桌面：表格 */}
            <div className="scroll-x hidden sm:block">
              <table className="data-table min-w-[600px]">
                <thead>
                  <tr>
                    <th className="w-10 text-right">#</th>
                    <th>代號</th>
                    <th>名稱</th>
                    <th className="cell-num">
                      <ColumnTip tip={COLUMN_TIPS.amt}>成交金額</ColumnTip>
                    </th>
                    <th className="cell-num">
                      <ColumnTip tip={COLUMN_TIPS.changePct}>漲跌</ColumnTip>
                    </th>
                    <th className="cell-num">
                      <ColumnTip tip={COLUMN_TIPS.close}>收盤</ColumnTip>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const open = expanded === r.code;
                    return (
                      <Fragment key={r.code}>
                        <tr
                          className={cn("cursor-pointer", open && "row-open")}
                          data-selected={open ? "true" : undefined}
                          onClick={() => toggle(r.code)}
                        >
                          <td className="num text-right text-muted-foreground">
                            {r.rank}
                          </td>
                          <td className="num font-medium">{r.code}</td>
                          <td>
                            <span className="inline-flex items-center gap-1.5">
                              {r.name}
                              <ChevronDown
                                className={cn(
                                  "size-3.5 text-muted-foreground transition-transform",
                                  open && "rotate-180",
                                )}
                                aria-hidden
                              />
                            </span>
                          </td>
                          <td className="cell-num font-semibold">
                            <Amount text={formatTurnoverYi(r.turnoverYi)} />
                          </td>
                          <td className={cn("cell-num", signedClass(r.changePct))}>
                            {formatPct(r.changePct)}
                          </td>
                          <td className="cell-num text-muted-foreground">
                            {r.close.toFixed(2)}
                          </td>
                        </tr>
                        {open ? (
                          <tr className="bg-sunken">
                            <td colSpan={6} className="px-3 py-3">
                              {hasFund(r) ? (
                                <FundMetricsGrid
                                  forwardPe={r.forwardPe}
                                  nextYearEps={r.nextYearEps}
                                  baseEps={r.baseEps}
                                  epsYoy={r.epsYoy}
                                />
                              ) : (
                                <p className="t-meta">{NO_FUND_HINT}</p>
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>
    </AppShell>
  );
}
