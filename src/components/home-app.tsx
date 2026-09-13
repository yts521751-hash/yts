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
import { readResponseJson } from "@/lib/read-response-json";
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
  const seed = ((): FlowClientSnapshot | null => {
    if (sessionFlow?.sectors && sessionFlow.sectors.length >= 20) return sessionFlow;
    if (initialFlow?.sectors && initialFlow.sectors.length >= 20 && initialFlow.brief) {
      return {
        sectors: initialFlow.sectors,
        brief: initialFlow.brief,
        source: initialFlow.source || "ssr",
      };
    }
    // 首屏就讀本機快取（不要等 useEffect），手機／電腦都先畫上個交易日
    if (typeof window !== "undefined") {
      const cached = readClientCache<FlowClientSnapshot>(CLIENT_CACHE_KEYS.flow);
      if (cached?.sectors && cached.sectors.length >= 20 && cached.brief) {
        sessionFlow = cached;
        return cached;
      }
    }
    return null;
  })();

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
  /** 本機同步工作階段：點擊後到真正完成前，進度列一律顯示 */
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{
    percent: number;
    label: string;
  } | null>(null);
  /** 使用者觸發的同步工作階段（與 server 輪詢解耦） */
  const syncSessionRef = useRef(false);
  /** force 請求是否已結束（成功或失敗） */
  const syncForceDoneRef = useRef(false);
  /** 是否已從伺服器看過 active／busy */
  const syncSeenBusyRef = useRef(false);
  /** 連續幾次輪詢都閒置（避免偶發空回應提早關） */
  const syncIdleStreakRef = useRef(0);
  const syncStartedAtRef = useRef(0);

  const endSyncSession = useCallback((final?: { percent: number; label: string }) => {
    if (final) setSyncProgress(final);
    syncSessionRef.current = false;
    syncForceDoneRef.current = false;
    syncSeenBusyRef.current = false;
    syncIdleStreakRef.current = 0;
    // 稍留完成態再隱藏
    window.setTimeout(() => {
      if (syncSessionRef.current) return;
      setSyncing(false);
      setSyncProgress(null);
    }, final ? 900 : 0);
  }, []);

  const startSyncSession = useCallback(() => {
    syncSessionRef.current = true;
    syncForceDoneRef.current = false;
    syncSeenBusyRef.current = false;
    syncIdleStreakRef.current = 0;
    syncStartedAtRef.current = Date.now();
    setSyncing(true);
    setSyncProgress({ percent: 1, label: "開始同步…" });
  }, []);

  /** 只更新進度數字；工作階段未結束前絕不隱藏 */
  const ingestProgress = useCallback(
    (data: {
      busy?: boolean;
      rebuildRunning?: boolean;
      backgroundBusy?: boolean;
      progress?: {
        active?: boolean;
        percent?: number;
        label?: string;
        error?: string | null;
      } | null;
      deploy?: {
        syncing?: boolean;
        rebuildRunning?: boolean;
        progress?: {
          active?: boolean;
          percent?: number;
          label?: string;
          error?: string | null;
        } | null;
      };
      rebuild?: { started?: boolean; alreadyRunning?: boolean } | null;
    }) => {
      if (!syncSessionRef.current) return;

      const prog = data.progress ?? data.deploy?.progress ?? null;
      const busy =
        Boolean(prog?.active) ||
        Boolean(data.busy) ||
        Boolean(data.rebuildRunning) ||
        Boolean(data.deploy?.syncing) ||
        Boolean(data.deploy?.rebuildRunning) ||
        Boolean(data.backgroundBusy) ||
        Boolean(data.rebuild?.started || data.rebuild?.alreadyRunning);

      if (busy || prog?.active) {
        syncSeenBusyRef.current = true;
        syncIdleStreakRef.current = 0;
        const percent = Math.max(
          1,
          Math.min(100, Number(prog?.percent) || 1),
        );
        const label = String(prog?.label || "同步中");
        setSyncing(true);
        setSyncProgress((prev) => ({
          // 百分比只增不減，避免輪詢抖動
          percent: Math.max(prev?.percent ?? 1, percent),
          label,
        }));
        return;
      }

      // 伺服器回報閒置：工作階段未就緒前一律保留本機進度列
      if (!syncForceDoneRef.current) {
        setSyncProgress((prev) => prev ?? { percent: 1, label: "同步中…" });
        return;
      }

      // force 已回來且看過 busy：連續 2 次閒置才結束（防抖）
      if (syncSeenBusyRef.current) {
        syncIdleStreakRef.current += 1;
        if (syncIdleStreakRef.current >= 2) {
          endSyncSession({
            percent: 100,
            label: prog?.error ? "同步失敗" : "同步完成",
          });
        }
        return;
      }

      // force 回來但從未看到 busy（極短／失敗）：至少顯示 1.5s 再關
      const shownMs = Date.now() - (syncStartedAtRef.current || 0);
      if (shownMs < 1500) {
        setSyncProgress((prev) => prev ?? { percent: 1, label: "同步中…" });
        return;
      }
      endSyncSession({
        percent: Number(prog?.percent) >= 100 ? 100 : 100,
        label: prog?.error ? "同步失敗" : "同步完成",
      });
    },
    [endSyncSession],
  );

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
      const data = await readResponseJson<{
        ok?: boolean;
        error?: string;
        isDemo?: boolean;
        source?: string;
        sectors?: SectorFlow[];
        brief?: MarketBrief;
        deploy?: Parameters<typeof ingestProgress>[0]["deploy"];
        backgroundBusy?: boolean;
        rebuild?: Parameters<typeof ingestProgress>[0]["rebuild"];
      }>(res, "資金流同步失敗");
      if (force) {
        // force 回應只負責帶進度；完成判定交給輪詢
        ingestProgress(data);
        syncForceDoneRef.current = true;
      } else if (syncSessionRef.current) {
        ingestProgress(data);
      }
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
      // force 同步失敗也要顯示（含伺服器回 HTML／冷啟動），不能只在無資料時提示
      if (force || !hadReal) {
        setError(e instanceof Error ? e.message : "載入失敗");
      }
      if (force && syncSessionRef.current) {
        // 請求失敗仍繼續輪詢進度（背景可能已啟動）；標記 force 已結束
        syncForceDoneRef.current = true;
      }
    } finally {
      setRefreshing(false);
    }
  }, [ingestProgress]);

  // 本機同步工作階段：輕量輪詢 /api/progress，只更新％，完成前不關 UI
  useEffect(() => {
    if (!syncing || !syncSessionRef.current) return;
    let cancelled = false;
    const tick = async () => {
      if (!syncSessionRef.current) return;
      try {
        const res = await fetch("/api/progress", { cache: "no-store" });
        const data = await readResponseJson<{
          busy?: boolean;
          rebuildRunning?: boolean;
          progress?: Parameters<typeof ingestProgress>[0]["progress"];
        }>(res, "進度查詢失敗");
        if (cancelled || !syncSessionRef.current) return;
        ingestProgress(data);
      } catch {
        /* 輪詢失敗不關進度列 */
      }
    };
    const id = window.setInterval(() => {
      void tick();
    }, 1000);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [syncing, ingestProgress]);

  const loadStocks = useCallback(async (force = false) => {
    setStocksLoading(true);
    setStocksError(null);
    try {
      const res = await fetch(
        `/api/stocks?limit=50${force ? "&force=1" : ""}`,
        { cache: "no-store" },
      );
      const data = await readResponseJson<{
        ok?: boolean;
        error?: string;
        rows?: StockFlowRankRow[];
        date?: string;
      }>(res, "個股資金流載入失敗");
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
      {syncing || syncProgress ? (
        <div
          className="sticky top-0 z-50 border-b px-4 py-2.5 shadow-sm sm:px-6"
          style={{
            borderColor: "var(--mk-anchor)",
            background: "var(--mk-anchor-bg)",
          }}
          role="status"
          aria-live="polite"
        >
          <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-semibold text-foreground">
                正在同步資料… {syncProgress?.percent ?? 0}%
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {syncProgress?.label || "請稍候"}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded bg-black/15 dark:bg-white/20">
              <div
                className="h-full rounded transition-[width] duration-300"
                style={{
                  width: `${Math.max(3, syncProgress?.percent ?? 0)}%`,
                  background: "var(--mk-anchor)",
                }}
              />
            </div>
          </div>
        </div>
      ) : null}
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
            <div className="flex flex-col items-end gap-1">
              <button
                type="button"
                onClick={() => {
                  if (boardMode === "stock") void loadStocks(true);
                  else {
                    startSyncSession();
                    void loadFlow(true);
                  }
                }}
                disabled={
                  boardMode === "stock"
                    ? stocksLoading
                    : syncing ||
                      (refreshing && sectors.length === 0) ||
                      (loadState === "loading" && sectors.length === 0)
                }
                className="border border-border bg-[var(--panel)] px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-[var(--mk-anchor)] hover:text-foreground disabled:opacity-50"
              >
                {boardMode === "stock"
                  ? stocksLoading
                    ? "讀取中…"
                    : "重新整理個股"
                  : syncing
                    ? `同步中 ${syncProgress?.percent ?? 0}%`
                    : refreshing && sectors.length === 0
                      ? "讀取中…"
                      : "補齊／更新歷史資料"}
              </button>
            </div>
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
