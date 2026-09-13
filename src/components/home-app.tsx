"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { SectorDetail } from "@/components/sector-detail";
import {
  SectorRanking,
  type RankPeriod,
} from "@/components/sector-ranking";
import { StatusCards } from "@/components/status-cards";
import {
  StockRanking,
  type StockFlowRankRow,
} from "@/components/stock-ranking";
import { FlowBulletin } from "@/components/flow-bulletin";
import {
  CLIENT_CACHE_KEYS,
  readClientCache,
  writeClientCache,
} from "@/lib/client-cache";
import { countByStatus, migrateSectorIfNeeded } from "@/lib/mock-data";
import type { MarketBrief, SectorFlow, TideStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

type TextSize = "sm" | "md" | "lg";
type LoadState = "loading" | "ready" | "error";
type BoardMode = "sector" | "stock";

type FlowClientSnapshot = {
  sectors: SectorFlow[];
  brief: MarketBrief;
  source: string;
};

type StocksClientSnapshot = {
  rows: StockFlowRankRow[];
  date: string;
};

export type InitialFlowProps = {
  sectors: SectorFlow[];
  brief: MarketBrief;
  source: string;
  isDemo?: boolean;
} | null;

/** 同一瀏覽器分頁內跨路由保活，避免從風度／成交頁返回又重抓蓋掉正確收盤資料 */
let sessionFlow: FlowClientSnapshot | null = null;

function isRealFlowPayload(data: {
  ok?: boolean;
  isDemo?: boolean;
  source?: unknown;
  sectors?: unknown[];
}) {
  return Boolean(
    data.ok &&
      !data.isDemo &&
      !String(data.source ?? "").includes("demo") &&
      (data.sectors?.length ?? 0) >= 20,
  );
}

export function HomeApp({
  initialFlow = null,
}: {
  initialFlow?: InitialFlowProps;
}) {
  const [filter, setFilter] = useState<TideStatus | "all">("all");
  const [boardMode, setBoardMode] = useState<BoardMode>("sector");
  const [selected, setSelected] = useState<SectorFlow | null>(null);
  const [flowPeriod, setFlowPeriod] = useState<RankPeriod>(() => {
    if (typeof window === "undefined") return "day";
    try {
      const v = sessionStorage.getItem("jinliu:flow-period:v1");
      if (v === "day" || v === "d3" || v === "d5") return v;
    } catch {
      /* ignore */
    }
    return "day";
  });

  useEffect(() => {
    try {
      sessionStorage.setItem("jinliu:flow-period:v1", flowPeriod);
    } catch {
      /* ignore */
    }
  }, [flowPeriod]);
  const [textSize, setTextSize] = useState<TextSize>("sm");
  const [dark, setDark] = useState(false);
  const seed =
    sessionFlow?.sectors && sessionFlow.sectors.length >= 20
      ? sessionFlow
      : initialFlow?.sectors && initialFlow.sectors.length >= 20
        ? {
            sectors: initialFlow.sectors,
            brief: initialFlow.brief,
            source: initialFlow.source || "ssr",
          }
        : null;

  const [sectors, setSectors] = useState<SectorFlow[]>(
    () => seed?.sectors.map(migrateSectorIfNeeded) ?? [],
  );
  const [stocks, setStocks] = useState<StockFlowRankRow[]>([]);
  const [stocksDate, setStocksDate] = useState("");
  const [stocksError, setStocksError] = useState<string | null>(null);
  const [stocksLoading, setStocksLoading] = useState(false);
  const [brief, setBrief] = useState<MarketBrief | null>(
    () => seed?.brief ?? null,
  );
  const [source, setSource] = useState(() => seed?.source ?? "");
  const [loadState, setLoadState] = useState<LoadState>(
    () => (seed?.sectors?.length ? "ready" : "loading"),
  );
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

      // SSR 真實資料才寫入 session／本機；避免把 demo／空殼蓋掉分頁內已有的正確收盤
      if (
        initialFlow?.sectors &&
        initialFlow.sectors.length >= 20 &&
        initialFlow.brief &&
        !initialFlow.isDemo &&
        !String(initialFlow.source || "").includes("demo")
      ) {
        const snap: FlowClientSnapshot = {
          sectors: initialFlow.sectors,
          brief: initialFlow.brief,
          source: initialFlow.source || "ssr",
        };
        sessionFlow = snap;
        writeClientCache<FlowClientSnapshot>(CLIENT_CACHE_KEYS.flow, snap);
      }

      // 已有 session／SSR 種子就不要再用可能更舊的 localStorage 覆蓋
      if (
        !initialFlow?.sectors?.length &&
        (sessionFlow?.sectors?.length ?? 0) < 20
      ) {
        const cached = readClientCache<FlowClientSnapshot>(CLIENT_CACHE_KEYS.flow);
        if (cached?.sectors && cached.sectors.length >= 20) {
          const next = cached.sectors.map(migrateSectorIfNeeded);
          const snap: FlowClientSnapshot = {
            sectors: next,
            brief: cached.brief,
            source: cached.source || "client-cache",
          };
          sessionFlow = snap;
          setSectors(next);
          setBrief(cached.brief);
          setSource(cached.source || "client-cache");
          setLoadState("ready");
        }
      }
      const cachedStocks = readClientCache<StocksClientSnapshot>(
        CLIENT_CACHE_KEYS.stocks,
      );
      if (cachedStocks?.rows?.length) {
        setStocks(cachedStocks.rows);
        setStocksDate(cachedStocks.date || "");
      }
    } catch {
      /* ignore */
    }
  }, []);

  const sectorsRef = useRef(sectors);
  const sourceRef = useRef(source);
  useEffect(() => {
    sectorsRef.current = sectors;
  }, [sectors]);
  useEffect(() => {
    sourceRef.current = source;
  }, [source]);

  const loadFlow = useCallback(async (force = false) => {
    const hadReal =
      sectorsRef.current.length >= 20 &&
      !String(sourceRef.current).includes("demo");
    // 已有正確畫面時靜默核對，不要打「讀取中／背景更新中」
    if (force || !hadReal) setRefreshing(true);
    if (force) setError(null);
    try {
      const res = await fetch(`/api/flow${force ? "?force=1" : ""}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!data.sectors?.length) throw new Error(data.error || "沒有板塊資料");
      const next = (data.sectors as SectorFlow[]).map(migrateSectorIfNeeded);
      const nextReal = isRealFlowPayload({
        ok: data.ok,
        isDemo: data.isDemo,
        source: data.source,
        sectors: next,
      });

      // 有真實收盤資料時，拒絕被 demo／半套結果蓋掉
      if (hadReal && !nextReal) {
        if (force) setError(String(data.error || "背景更新尚未完成，仍顯示上個交易日資料"));
        return;
      }
      if (hadReal && nextReal && next.length < Math.floor(sectorsRef.current.length * 0.6)) {
        return;
      }

      setSectors(next);
      setBrief(data.brief as MarketBrief);
      setSource(String(data.source ?? ""));
      setLoadState("ready");
      if (!data.ok && data.error && !hadReal) setError(String(data.error));
      if (nextReal) {
        const snap: FlowClientSnapshot = {
          sectors: next,
          brief: data.brief as MarketBrief,
          source: String(data.source ?? ""),
        };
        sessionFlow = snap;
        writeClientCache<FlowClientSnapshot>(CLIENT_CACHE_KEYS.flow, snap);
      }
      setSelected((prev) => {
        if (!prev) return prev;
        return next.find((s) => s.id === prev.id) ?? null;
      });
    } catch (e) {
      setLoadState((s) => (s === "ready" ? "ready" : "error"));
      if (!hadReal) setError(e instanceof Error ? e.message : "載入失敗");
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
      writeClientCache<StocksClientSnapshot>(CLIENT_CACHE_KEYS.stocks, {
        rows: data.rows as StockFlowRankRow[],
        date: String(data.date || ""),
      });
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

  const sectorBulletinRows = useMemo(
    () =>
      sectors.map((s) => ({
        id: s.id,
        name: s.name,
        dayFlow: s.dayFlow,
        d3Flow: s.d3Flow ?? 0,
        d5Flow: s.d5Flow,
      })),
    [sectors],
  );

  const stockBulletinRows = useMemo(
    () =>
      stocks.map((s) => ({
        id: s.code,
        name: `${s.name} ${s.code}`,
        dayFlow: s.dayFlow,
        d3Flow: s.d3Flow ?? 0,
        d5Flow: s.d5Flow,
      })),
    [stocks],
  );

  // 公布欄個股資料背景預載
  useEffect(() => {
    if (stocks.length || stocksLoading) return;
    void loadStocks(false);
  }, [stocks.length, stocksLoading, loadStocks]);

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
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  手機／電腦共用成交額→淨流排序 ·{" "}
                  <Link
                    href="/ma"
                    className="text-[var(--mk-anchor)] underline-offset-2 hover:underline"
                  >
                    產業均線掃描
                  </Link>
                </p>
              )}
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
                  : (refreshing && sectors.length === 0) ||
                    (loadState === "loading" && sectors.length === 0)
              }
              className="border border-border bg-[var(--panel)] px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-[var(--mk-anchor)] hover:text-foreground disabled:opacity-50"
            >
              {boardMode === "stock"
                ? stocksLoading
                  ? "讀取中…"
                  : "重新整理個股"
                : refreshing && sectors.length === 0
                  ? "讀取中…"
                  : refreshing
                    ? "已觸發更新"
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
              <StatusCards
                counts={counts}
                active={filter}
                onChange={setFilter}
              />
            )
          ) : null}
        </section>

        {boardMode === "sector" ? (
          <FlowBulletin title="板塊金流公布欄" rows={sectorBulletinRows} />
        ) : (
          <FlowBulletin title="個股金流公布欄" rows={stockBulletinRows} />
        )}

        {boardMode === "sector" && sectors.length > 0 && (
          <>
            <section className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
              <div className="min-h-[320px] border border-border bg-[var(--panel)] p-2 sm:min-h-[480px] sm:p-3">
                <SectorRanking
                  sectors={sectors}
                  selectedId={selected?.id}
                  onSelect={(s) => {
                    setSelected(s);
                    // 點選板塊時預熱產業 K 線，稍後開啟幾乎不用等
                    void fetch(
                      `/api/sector/${encodeURIComponent(s.id)}?days=80`,
                      { cache: "force-cache" },
                    ).catch(() => null);
                  }}
                  filter={filter}
                  kindFilter="all"
                  period={flowPeriod}
                  onPeriodChange={setFlowPeriod}
                />
              </div>
              <div className="hidden lg:block">
                <SectorDetail
                  sector={selected}
                  onClose={() => setSelected(null)}
                  period={flowPeriod}
                  onPeriodChange={setFlowPeriod}
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
                <div
                  className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-auto rounded-t-2xl border border-border/60 bg-[var(--panel)] p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <SectorDetail
                    sector={selected}
                    onClose={() => setSelected(null)}
                    period={flowPeriod}
                    onPeriodChange={setFlowPeriod}
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
