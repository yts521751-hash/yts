"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw, X } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { SyncBanner } from "@/components/sync-banner";
import { ActionButton } from "@/components/ui/action-button";
import { Segmented } from "@/components/ui/segmented";
import { Panel } from "@/components/ui/panel";
import { ErrorState, LoadingState, NoticeBar } from "@/components/ui/states";
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
import type { MarketId } from "@/components/market-switch";

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
let sessionFlowTw: FlowClientSnapshot | null = null;
let sessionFlowUs: FlowClientSnapshot | null = null;

function isRealFlowPayload(
  data: {
    ok?: boolean;
    isDemo?: boolean;
    source?: unknown;
    sectors?: unknown[];
  },
  market: MarketId,
) {
  const minSectors = market === "us" ? 5 : 20;
  return Boolean(
    data.ok &&
      !data.isDemo &&
      !String(data.source ?? "").includes("demo") &&
      (data.sectors?.length ?? 0) >= minSectors,
  );
}

export function HomeApp({
  initialFlow = null,
  market = "tw",
}: {
  initialFlow?: InitialFlowProps;
  market?: MarketId;
}) {
  const apiBase = market === "us" ? "/api/us" : "/api";
  const minSectors = market === "us" ? 5 : 20;
  const flowCacheKey =
    market === "us" ? `${CLIENT_CACHE_KEYS.flow}:us` : CLIENT_CACHE_KEYS.flow;
  const stocksCacheKey =
    market === "us"
      ? `${CLIENT_CACHE_KEYS.stocks}:us`
      : CLIENT_CACHE_KEYS.stocks;
  const getSession = () => (market === "us" ? sessionFlowUs : sessionFlowTw);
  const setSession = (snap: FlowClientSnapshot | null) => {
    if (market === "us") sessionFlowUs = snap;
    else sessionFlowTw = snap;
  };
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
  const seed = ((): FlowClientSnapshot | null => {
    const session = getSession();
    if (session?.sectors && session.sectors.length >= minSectors) return session;
    if (
      initialFlow?.sectors &&
      initialFlow.sectors.length >= minSectors &&
      initialFlow.brief
    ) {
      return {
        sectors: initialFlow.sectors,
        brief: initialFlow.brief,
        source: initialFlow.source || "ssr",
      };
    }
    // 首屏就讀本機快取（不要等 useEffect），手機／電腦都先畫上個交易日
    if (typeof window !== "undefined") {
      const cached = readClientCache<FlowClientSnapshot>(flowCacheKey);
      if (cached?.sectors && cached.sectors.length >= minSectors && cached.brief) {
        setSession(cached);
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
  /** 前景同步中：進度列由本機狀態驅動，串流只更新％ */
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{
    percent: number;
    label: string;
  } | null>(null);

  useEffect(() => {
    try {
      // SSR 真實資料才寫入 session／本機；避免把 demo／空殼蓋掉分頁內已有的正確收盤
      if (
        initialFlow?.sectors &&
        initialFlow.sectors.length >= minSectors &&
        initialFlow.brief &&
        !initialFlow.isDemo &&
        !String(initialFlow.source || "").includes("demo")
      ) {
        const snap: FlowClientSnapshot = {
          sectors: initialFlow.sectors,
          brief: initialFlow.brief,
          source: initialFlow.source || "ssr",
        };
        setSession(snap);
        writeClientCache<FlowClientSnapshot>(flowCacheKey, snap);
      }

      // 已有 session／SSR 種子就不要再用可能更舊的 localStorage 覆蓋
      if (
        !initialFlow?.sectors?.length &&
        (getSession()?.sectors?.length ?? 0) < minSectors
      ) {
        const cached = readClientCache<FlowClientSnapshot>(flowCacheKey);
        if (cached?.sectors && cached.sectors.length >= minSectors) {
          const next = cached.sectors.map(migrateSectorIfNeeded);
          const snap: FlowClientSnapshot = {
            sectors: next,
            brief: cached.brief,
            source: cached.source || "client-cache",
          };
          setSession(snap);
          setSectors(next);
          setBrief(cached.brief);
          setSource(cached.source || "client-cache");
          setLoadState("ready");
        }
      }
      const cachedStocks = readClientCache<StocksClientSnapshot>(stocksCacheKey);
      if (cachedStocks?.rows?.length) {
        setStocks(cachedStocks.rows);
        setStocksDate(cachedStocks.date || "");
      }
    } catch {
      /* ignore */
    }
    // mount hydrate once per market
  }, [market]);

  const sectorsRef = useRef(sectors);
  const sourceRef = useRef(source);
  useEffect(() => {
    sectorsRef.current = sectors;
  }, [sectors]);
  useEffect(() => {
    sourceRef.current = source;
  }, [source]);

  const loadFlow = useCallback(async () => {
    const hadReal =
      sectorsRef.current.length >= minSectors &&
      !String(sourceRef.current).includes("demo");
    // 已有正確畫面時靜默核對，不要打「讀取中」
    if (!hadReal) setRefreshing(true);
    try {
      const res = await fetch(`${apiBase}/flow`, { cache: "no-store" });
      const data = await readResponseJson<{
        ok?: boolean;
        error?: string;
        isDemo?: boolean;
        source?: string;
        sectors?: SectorFlow[];
        brief?: MarketBrief;
      }>(res, "資金流載入失敗");
      if (!data.sectors?.length) throw new Error(data.error || "沒有板塊資料");
      const next = (data.sectors as SectorFlow[]).map(migrateSectorIfNeeded);
      const nextReal = isRealFlowPayload(
        {
          ok: data.ok,
          isDemo: data.isDemo,
          source: data.source,
          sectors: next,
        },
        market,
      );

      // 有真實收盤資料時，拒絕被 demo／半套結果蓋掉
      if (hadReal && !nextReal) return;
      if (
        hadReal &&
        nextReal &&
        next.length < Math.floor(sectorsRef.current.length * 0.6)
      ) {
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
        setSession(snap);
        writeClientCache<FlowClientSnapshot>(flowCacheKey, snap);
      }
      setSelected((prev) => {
        if (!prev) return prev;
        return next.find((s) => s.id === prev.id) ?? null;
      });
    } catch (e) {
      setLoadState((s) => (s === "ready" ? "ready" : "error"));
      if (!hadReal) {
        setError(e instanceof Error ? e.message : "載入失敗");
      }
    } finally {
      setRefreshing(false);
    }
  }, [apiBase, flowCacheKey, market, minSectors]);

  /** 前景同步：同一條 /api/sync 串流推進度，跑完再刷新畫面 */
  const runForegroundSync = useCallback(async () => {
    if (syncing) return;
    setError(null);
    setSyncing(true);
    setSyncProgress({ percent: 1, label: market === "us" ? "開始同步美股…" : "開始同步…" });
    let ok = false;
    let errMsg: string | null = null;
    try {
      const res = await fetch(`${apiBase}/sync`, { cache: "no-store" });
      if (!res.ok || !res.body) {
        throw new Error(`同步請求失敗（HTTP ${res.status}）`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let msg: {
            type?: string;
            percent?: number;
            label?: string;
            ok?: boolean;
            error?: string;
          };
          try {
            msg = JSON.parse(trimmed);
          } catch {
            continue;
          }
          if (msg.type === "progress") {
            const percent = Math.max(
              1,
              Math.min(100, Number(msg.percent) || 1),
            );
            const label = String(msg.label || "同步中");
            setSyncProgress((prev) => ({
              percent: Math.max(prev?.percent ?? 1, percent),
              label,
            }));
          } else if (msg.type === "done") {
            ok = Boolean(msg.ok);
            errMsg = msg.error ? String(msg.error) : null;
            const skipped = Boolean(
              (msg as { skippedCurrent?: boolean }).skippedCurrent,
            );
            setSyncProgress({
              percent: 100,
              label: !ok
                ? "同步失敗"
                : skipped
                  ? "資料已是最新"
                  : "同步完成",
            });
          }
        }
      }
      if (!ok && errMsg) throw new Error(errMsg);
      if (!ok) throw new Error("同步未完成");
      await loadFlow();
    } catch (e) {
      const message = e instanceof Error ? e.message : "同步失敗";
      setError(message);
      setSyncProgress({ percent: 100, label: "同步失敗" });
    } finally {
      window.setTimeout(() => {
        setSyncing(false);
        setSyncProgress(null);
      }, 800);
    }
  }, [syncing, loadFlow, apiBase, market]);

  const loadStocks = useCallback(async (force = false) => {
    setStocksLoading(true);
    setStocksError(null);
    try {
      const res = await fetch(
        `${apiBase}/stocks?limit=50${force ? "&force=1" : ""}`,
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
      writeClientCache<StocksClientSnapshot>(stocksCacheKey, {
        rows: data.rows as StockFlowRankRow[],
        date: String(data.date || ""),
      });
    } catch (e) {
      setStocksError(e instanceof Error ? e.message : "個股資金流載入失敗");
    } finally {
      setStocksLoading(false);
    }
  }, [apiBase, stocksCacheKey]);

  useEffect(() => {
    void loadFlow();
  }, [loadFlow]);

  useEffect(() => {
    if (boardMode !== "stock") return;
    if (stocks.length || stocksLoading) return;
    void loadStocks(false);
  }, [boardMode, stocks.length, stocksLoading, loadStocks]);

  // 行動版板塊明細 sheet：Esc 關閉
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);


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

  const syncBusy = Boolean(syncing || syncProgress);
  const refreshDisabled =
    boardMode === "stock"
      ? stocksLoading
      : syncing ||
        (refreshing && sectors.length === 0) ||
        (loadState === "loading" && sectors.length === 0);
  const refreshLabel =
    boardMode === "stock"
      ? stocksLoading
        ? "讀取中…"
        : "重新整理個股"
      : syncing
        ? `同步中 ${syncProgress?.percent ?? 0}%`
        : refreshing && sectors.length === 0
          ? "讀取中…"
          : "同步資料";

  return (
    <AppShell
      market={market}
      width="wide"
      dateLabel={brief?.date}
      updatedAt={brief?.updatedAt}
      isDemo={isDemo}
      fearLabel={brief?.fearLabel}
      fearScore={brief?.fearScore}
      banner={
        syncBusy ? (
          <SyncBanner
            progress={syncProgress ?? { percent: 0, label: "請稍候" }}
          />
        ) : null
      }
      eyebrow={market === "us" ? "US MONEY FLOW" : "TAIWAN MONEY FLOW"}
      title={boardMode === "sector" ? "板塊資金流排行榜" : "個股資金流排行榜"}
      description={
        boardMode === "stock" && stocksDate ? (
          market === "us" ? (
            `資料日 ${stocksDate}｜美股金流 ＝ 成交×漲跌 ＋ 相對成交量`
          ) : (
            `資料日 ${stocksDate}｜與板塊相同金流公式（成交×漲跌 80% ＋ 法人 20%）`
          )
        ) : market === "us" ? (
          "依成交額→淨流排序，手機與電腦共用同一份排名。"
        ) : (
          <>
            依成交額→淨流排序，手機與電腦共用同一份排名。也可看{" "}
            <Link
              href="/ma"
              className="font-medium text-[var(--mk-anchor)] underline-offset-4 hover:underline"
            >
              產業均線掃描
            </Link>
            。
          </>
        )
      }
      actions={
        <>
          <Segmented
            ariaLabel="看板模式"
            value={boardMode}
            onChange={setBoardMode}
            items={[
              { value: "sector", label: "板塊金流" },
              { value: "stock", label: "個股金流" },
            ]}
          />
          <ActionButton
            onClick={() => {
              if (boardMode === "stock") void loadStocks(true);
              else void runForegroundSync();
            }}
            disabled={refreshDisabled}
          >
            <RefreshCw
              className={cn(
                "size-3.5",
                (syncing || stocksLoading || refreshing) && "animate-spin",
              )}
              aria-hidden
            />
            {refreshLabel}
          </ActionButton>
        </>
      }
      notice={
        error && boardMode === "sector" && sectors.length > 0 ? (
          <NoticeBar tone="warn">
            {isDemo
              ? `真實資料暫不可用，已改顯示示範資料：${error}`
              : `提醒：${error}`}
          </NoticeBar>
        ) : null
      }
    >
        {boardMode === "sector" ? (
          loadState === "loading" && !sectors.length ? (
            <Panel>
              <LoadingState label="載入板塊資金流…" />
            </Panel>
          ) : loadState === "error" && !sectors.length ? (
            <Panel>
              <ErrorState
                description={error ?? undefined}
                action={
                  <ActionButton size="sm" onClick={() => void loadFlow()}>
                    再試一次
                  </ActionButton>
                }
              />
            </Panel>
          ) : (
            <StatusCards counts={counts} active={filter} onChange={setFilter} />
          )
        ) : null}

        {boardMode === "sector" ? (
          <FlowBulletin
            title="板塊金流公布欄"
            rows={sectorBulletinRows}
            market={market}
          />
        ) : (
          <FlowBulletin
            title="個股金流公布欄"
            rows={stockBulletinRows}
            market={market}
          />
        )}

        {boardMode === "sector" && sectors.length > 0 && (
          <>
            <section className="grid gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(320px,1fr)] lg:items-start">
              <Panel className="min-h-[360px] overflow-hidden sm:min-h-[520px]">
                <SectorRanking
                  sectors={sectors}
                  selectedId={selected?.id}
                  onSelect={(s) => {
                    setSelected(s);
                    // 台股：點選板塊時預熱產業 K 線；美股版不提供 K 線入口
                    if (market !== "us") {
                      void fetch(
                        `${apiBase}/sector/${encodeURIComponent(s.id)}?days=80`,
                        { cache: "force-cache" },
                      ).catch(() => null);
                    }
                  }}
                  filter={filter}
                  kindFilter="all"
                  period={flowPeriod}
                  onPeriodChange={setFlowPeriod}
                  market={market}
                />
              </Panel>
              <div className="hidden lg:sticky lg:top-[7.75rem] lg:block lg:max-h-[calc(100vh-9rem)]">
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
                  className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
                  aria-label="關閉板塊明細"
                  onClick={() => setSelected(null)}
                />
                <div
                  className="surface-raised absolute inset-x-0 bottom-0 flex max-h-[88vh] flex-col rounded-b-none pb-[env(safe-area-inset-bottom)]"
                  role="dialog"
                  aria-modal="true"
                  aria-label={`${selected.name} 板塊明細`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-1">
                    <span
                      className="mx-auto h-1 w-10 rounded-full bg-line-strong"
                      aria-hidden
                    />
                    <button
                      type="button"
                      onClick={() => setSelected(null)}
                      aria-label="關閉"
                      className="absolute right-2 top-2 inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sunken hover:text-foreground"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </div>
                  <SectorDetail
                    variant="sheet"
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
          <Panel className="min-h-[360px] overflow-hidden sm:min-h-[520px]">
            {stocksLoading && !stocks.length ? (
              <LoadingState label="載入個股資金流…" />
            ) : stocksError && !stocks.length ? (
              <ErrorState
                title="無法載入個股資金流"
                description={stocksError}
                action={
                  <ActionButton size="sm" onClick={() => void loadStocks(true)}>
                    再試一次
                  </ActionButton>
                }
              />
            ) : (
              <StockRanking rows={stocks} limit={20} market={market} />
            )}
          </Panel>
        )}
    </AppShell>
  );
}
