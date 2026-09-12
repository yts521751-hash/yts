"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { SectorDetail } from "@/components/sector-detail";
import { SectorRanking } from "@/components/sector-ranking";
import { StatusCards } from "@/components/status-cards";
import {
  StockRanking,
  type StockFlowRankRow,
} from "@/components/stock-ranking";
import { countByStatus, migrateSectorIfNeeded } from "@/lib/mock-data";
import type { MarketBrief, SectorFlow, TideStatus } from "@/lib/types";
import type { KindFilter } from "@/components/sector-ranking";
import { cn } from "@/lib/utils";

type TextSize = "sm" | "md" | "lg";
type LoadState = "loading" | "ready" | "error";
type BoardMode = "sector" | "stock";

export function HomeApp() {
  const [filter, setFilter] = useState<TideStatus | "all">("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [boardMode, setBoardMode] = useState<BoardMode>("sector");
  const [selected, setSelected] = useState<SectorFlow | null>(null);
  const [textSize, setTextSize] = useState<TextSize>("sm");
  const [dark, setDark] = useState(false);
  const [sectors, setSectors] = useState<SectorFlow[]>([]);
  const [stocks, setStocks] = useState<StockFlowRankRow[]>([]);
  const [stocksDate, setStocksDate] = useState("");
  const [stocksError, setStocksError] = useState<string | null>(null);
  const [stocksLoading, setStocksLoading] = useState(false);
  const [brief, setBrief] = useState<MarketBrief | null>(null);
  const [source, setSource] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    try {
      const ts = (localStorage.getItem("jinchao_text") as TextSize) || "sm";
      const theme = localStorage.getItem("jinchao_theme");
      const preferDark =
        theme === "dark" ||
        (theme !== "light" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);
      setTextSize(ts);
      setDark(preferDark);
      document.documentElement.dataset.textsize = ts;
      document.documentElement.classList.toggle("dark", preferDark);
    } catch {
      /* ignore */
    }
  }, []);

  const loadFlow = useCallback(async (force = false) => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(`/api/flow${force ? "?force=1" : ""}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!data.sectors?.length) throw new Error(data.error || "沒有板塊資料");
      const next = (data.sectors as SectorFlow[]).map(migrateSectorIfNeeded);
      setSectors(next);
      setBrief(data.brief as MarketBrief);
      setSource(String(data.source ?? ""));
      setSyncing(Boolean(data.syncing));
      setLoadState("ready");
      if (!data.ok && data.error) setError(String(data.error));
      setSelected((prev) => {
        if (!prev) return prev;
        return next.find((s) => s.id === prev.id) ?? null;
      });
    } catch (e) {
      setLoadState((s) => (s === "ready" ? "ready" : "error"));
      setError(e instanceof Error ? e.message : "載入失敗");
    } finally {
      setRefreshing(false);
    }
  }, []);

  const loadStocks = useCallback(async (force = false) => {
    setStocksLoading(true);
    setStocksError(null);
    try {
      const res = await fetch(
        `/api/stocks?limit=50${force ? "&force=1" : ""}`,
        { cache: "no-store" },
      );
      const data = await res.json();
      if (!data.ok || !data.rows?.length) {
        throw new Error(data.error || "沒有個股資金流資料");
      }
      setStocks(data.rows as StockFlowRankRow[]);
      setStocksDate(String(data.date || ""));
    } catch (e) {
      setStocksError(e instanceof Error ? e.message : "個股資金流載入失敗");
    } finally {
      setStocksLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFlow(false);
  }, [loadFlow]);

  useEffect(() => {
    if (boardMode !== "stock") return;
    if (stocks.length || stocksLoading) return;
    void loadStocks(false);
  }, [boardMode, stocks.length, stocksLoading, loadStocks]);

  useEffect(() => {
    if (!syncing) return;
    const t = setInterval(() => void loadFlow(false), 8000);
    return () => clearInterval(t);
  }, [syncing, loadFlow]);

  const onTextSize = (s: TextSize) => {
    setTextSize(s);
    document.documentElement.dataset.textsize = s;
    try {
      localStorage.setItem("jinchao_text", s);
    } catch {
      /* ignore */
    }
  };

  const onToggleDark = () => {
    setDark((d) => {
      const next = !d;
      document.documentElement.classList.toggle("dark", next);
      try {
        localStorage.setItem("jinchao_theme", next ? "dark" : "light");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const counts = useMemo(() => countByStatus(sectors), [sectors]);
  const isDemo = brief?.isDemo === true || source.includes("demo");

  return (
    <div className="relative flex min-h-full flex-1 flex-col">
      <div
        className="studio-atmosphere pointer-events-none absolute inset-0"
        aria-hidden
      />
      <AppHeader
        dateLabel={brief?.date ?? "載入中"}
        updatedAt={brief?.updatedAt ?? "—"}
        isDemo={isDemo}
        fearLabel={brief?.fearLabel ?? "—"}
        fearScore={brief?.fearScore ?? 0}
        textSize={textSize}
        onTextSize={onTextSize}
        dark={dark}
        onToggleDark={onToggleDark}
      />

      <main className="relative z-10 mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight sm:text-3xl">
                {boardMode === "sector" ? "板塊資金流排行榜" : "個股資金流排行榜"}
              </h1>
              {boardMode === "stock" && stocksDate ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  資料日 {stocksDate} · 與板塊相同金流公式（成交×漲跌 80%＋法人 20%）
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                if (boardMode === "stock") void loadStocks(true);
                else void loadFlow(true);
              }}
              disabled={
                boardMode === "stock"
                  ? stocksLoading
                  : refreshing || loadState === "loading"
              }
              className="border border-border bg-[var(--panel)] px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-[var(--mk-anchor)] hover:text-foreground disabled:opacity-50"
            >
              {boardMode === "stock"
                ? stocksLoading
                  ? "讀取中…"
                  : "重新整理個股"
                : refreshing || loadState === "loading"
                  ? "讀取中…"
                  : syncing
                    ? "背景同步中…"
                    : "觸發背景更新"}
            </button>
          </div>

          <div className="inline-flex border border-border bg-muted/30 p-0.5">
            {(
              [
                ["sector", "板塊金流"],
                ["stock", "個股金流"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setBoardMode(key)}
                className={cn(
                  "px-3 py-1.5 text-xs transition",
                  boardMode === key
                    ? "bg-[var(--mk-anchor)] font-semibold text-white"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {error && boardMode === "sector" && (
            <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              {isDemo
                ? `真實資料暫不可用，已改顯示示範資料：${error}`
                : `提醒：${error}`}
            </p>
          )}

          {boardMode === "sector" ? (
            loadState === "loading" && !sectors.length ? (
              <div className="border border-border bg-[var(--panel)] px-4 py-10 text-center text-sm text-muted-foreground">
                載入中…
              </div>
            ) : loadState === "error" && !sectors.length ? (
              <div className="border border-destructive/30 bg-destructive/5 px-4 py-10 text-center text-sm">
                <p className="font-medium">無法載入資料</p>
                <p className="mt-1 text-muted-foreground">{error}</p>
                <button
                  type="button"
                  className="mt-3 rounded-lg border px-3 py-1.5 text-xs"
                  onClick={() => void loadFlow(false)}
                >
                  再試一次
                </button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ["all", "全部"],
                      ["industry", "官方產業"],
                      ["theme", "題材"],
                      ["auto", "新興自動"],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setKindFilter(k)}
                      className={cn(
                        "border px-2.5 py-1 text-xs transition",
                        kindFilter === k
                          ? "border-[var(--mk-anchor)] bg-[var(--mk-anchor)] text-white"
                          : "border-border bg-muted/30 text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <StatusCards
                  counts={counts}
                  active={filter}
                  onChange={setFilter}
                />
              </>
            )
          ) : null}
        </section>

        {boardMode === "sector" && sectors.length > 0 && (
          <>
            <section className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
              <div className="min-h-[320px] border border-border bg-[var(--panel)] p-2 sm:min-h-[480px] sm:p-3">
                <SectorRanking
                  sectors={sectors}
                  selectedId={selected?.id}
                  onSelect={setSelected}
                  filter={filter}
                  kindFilter={kindFilter}
                />
              </div>
              <div className="hidden lg:block">
                <SectorDetail
                  sector={selected}
                  onClose={() => setSelected(null)}
                />
              </div>
            </section>
            {selected && (
              <div className="fixed inset-0 z-50 lg:hidden">
                <button
                  type="button"
                  className="absolute inset-0 bg-black/40"
                  aria-label="關閉"
                  onClick={() => setSelected(null)}
                />
                <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-auto rounded-t-2xl border border-border/60 bg-[var(--panel)] p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl">
                  <SectorDetail
                    sector={selected}
                    onClose={() => setSelected(null)}
                  />
                </div>
              </div>
            )}
          </>
        )}

        {boardMode === "stock" && (
          <section className="min-h-[320px] border border-border bg-[var(--panel)] p-2 sm:min-h-[480px] sm:p-3">
            {stocksLoading && !stocks.length ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                載入個股資金流…
              </p>
            ) : stocksError && !stocks.length ? (
              <div className="px-4 py-10 text-center text-sm">
                <p className="font-medium">無法載入個股資金流</p>
                <p className="mt-1 text-muted-foreground">{stocksError}</p>
                <button
                  type="button"
                  className="mt-3 border px-3 py-1.5 text-xs"
                  onClick={() => void loadStocks(true)}
                >
                  再試一次
                </button>
              </div>
            ) : (
              <StockRanking rows={stocks} limit={20} />
            )}
          </section>
        )}
      </main>

      <footer className="relative z-10 space-y-1 border-t border-border/40 py-4 text-center text-[11px] text-muted-foreground">
        <p>金流看板</p>
        <p>資料來源：臺灣證券交易所、證券櫃檯買賣中心公開資料</p>
      </footer>
    </div>
  );
}
