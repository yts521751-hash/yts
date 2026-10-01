"use client";

import Link from "next/link";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  CLIENT_CACHE_KEYS,
  readClientCache,
  writeClientCache,
} from "@/lib/client-cache";
import {
  formatPct,
  formatTurnoverYi,
  formatUsTurnoverYi,
  signedClass,
} from "@/lib/format";
import type {
  StockValueLookup,
  ValuePickRow,
  ValuePicksPayload,
} from "@/lib/value-picks";
import { cn } from "@/lib/utils";
import {
  BrokerTargetsDetail,
  FundMetricsGrid,
} from "@/components/broker-targets-detail";
import { MarketSwitch } from "@/components/market-switch";
import { UsStockName } from "@/components/us-stock-name";

type SortKey = "epsYoy" | "forwardPe" | "dayAmt" | "close" | "changePct";

type ClientPayload = ValuePicksPayload & {
  market?: "tw" | "us";
  note?: string;
  emptyReason?: string | null;
  epsOk?: number;
};

const LOOKUP_CLIENT_TTL_MS = 30 * 60 * 1000;
const lookupClientCache = new Map<
  string,
  { at: number; value: StockValueLookup }
>();

function lookupCacheKey(market: "tw" | "us", q: string) {
  return `${market}:${q.trim().toLowerCase()}`;
}

function isUsTickerQuery(q: string) {
  return /^[A-Za-z]{1,5}(\.[A-Za-z])?$/.test(q.trim());
}

function fmtTurnover(n: number, market: "tw" | "us") {
  return market === "us" ? formatUsTurnoverYi(n) : formatTurnoverYi(n);
}

function lookupFromLocalRow(
  row: ValuePickRow,
  ymd: string,
  date: string,
): StockValueLookup {
  return {
    code: row.code,
    name: row.name,
    close: row.close,
    changePct: row.changePct,
    dayAmt: row.dayAmt,
    nextYearEps: row.nextYearEps,
    baseEps: row.baseEps,
    epsYoy: row.epsYoy,
    forwardPe: row.forwardPe,
    epsSource: row.epsSource,
    revenueYoy: null,
    revenueMonth: null,
    brokers: row.brokers ?? [],
    consensusBasis: row.consensusBasis ?? null,
    passesScreen: true,
    ymd,
    date,
  };
}

function findLocalRow(
  rows: ValuePickRow[],
  q: string,
  market: "tw" | "us",
): ValuePickRow | null {
  const needle = q.trim().toLowerCase();
  if (!needle) return null;
  if (market === "us") {
    if (isUsTickerQuery(q)) {
      const upper = q.trim().toUpperCase();
      const byCode = rows.find((r) => r.code.toUpperCase() === upper);
      if (byCode) return byCode;
    }
    return (
      rows.find(
        (r) =>
          r.name.toLowerCase() === needle ||
          r.name.toLowerCase().includes(needle) ||
          needle.includes(r.name.toLowerCase()),
      ) || null
    );
  }
  return (
    (/^\d{4}$/.test(q) && rows.find((r) => r.code === q)) ||
    rows.find(
      (r) =>
        r.name === q ||
        r.name.toLowerCase().includes(needle) ||
        needle.includes(r.name.toLowerCase()),
    ) ||
    null
  );
}

function sortValue(row: ValuePickRow, key: SortKey) {
  if (key === "forwardPe") return row.forwardPe;
  if (key === "dayAmt") return row.dayAmt;
  if (key === "close") return row.close;
  if (key === "changePct") return row.changePct;
  return row.epsYoy;
}

function seedFrom(initial: ClientPayload | null, market: "tw" | "us") {
  if (initial?.rows?.length) return { data: initial, fromCache: false };
  if (typeof window === "undefined") return { data: null, fromCache: false };
  const key =
    market === "us"
      ? `${CLIENT_CACHE_KEYS.value}:us`
      : CLIENT_CACHE_KEYS.value;
  const cached = readClientCache<ClientPayload>(key);
  if (cached?.rows?.length) return { data: cached, fromCache: true };
  return { data: null, fromCache: false };
}

export function ValuePicksClient({
  initial,
  market = "tw",
}: {
  initial: ClientPayload | null;
  market?: "tw" | "us";
}) {
  const apiBase = market === "us" ? "/api/us" : "/api";
  const homeHref = market === "us" ? "/us" : "/";
  const clientCacheKey =
    market === "us"
      ? `${CLIENT_CACHE_KEYS.value}:us`
      : CLIENT_CACHE_KEYS.value;
  const defaultMinYoy = market === "us" ? 25 : 50;
  const defaultMaxPe = market === "us" ? 40 : 35;
  const defaultMinAmt = market === "us" ? 0.5 : 10;

  const seeded = seedFrom(initial, market);
  const [data, setData] = useState<ClientPayload | null>(() => seeded.data);
  const [loading, setLoading] = useState(() => !seeded.data?.rows?.length);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("epsYoy");
  const [asc, setAsc] = useState(false);
  const [fromCache, setFromCache] = useState(() => seeded.fromCache);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState<StockValueLookup | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const lookupAbortRef = useRef<AbortController | null>(null);
  const lookupSeqRef = useRef(0);

  const load = useCallback(
    async (force = false) => {
      setError(null);
      if (force) setRefreshing(true);
      else if (!data?.rows?.length) setLoading(true);
      try {
        const res = await fetch(`${apiBase}/value${force ? "?force=1" : ""}`, {
          cache: "no-store",
        });
        const json = (await res.json()) as ClientPayload & {
          ok?: boolean;
          error?: string;
        };
        if (!res.ok || json.ok === false) {
          throw new Error(json.error || `HTTP ${res.status}`);
        }
        setData(json);
        setFromCache(false);
        writeClientCache(clientCacheKey, json);
      } catch (e) {
        if (!data?.rows?.length) {
          setError(e instanceof Error ? e.message : "載入失敗");
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [apiBase, clientCacheKey, data?.rows?.length],
  );

  useEffect(() => {
    if (seeded.data?.rows?.length) {
      setLoading(false);
      return;
    }
    void load(false);
    // 僅冷啟動拉一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runLookup = useCallback(
    async (raw?: string) => {
      const q = (raw ?? query).trim();
      if (!q) {
        setLookup(null);
        setLookupError(null);
        setLookupLoading(false);
        return;
      }

      const key = lookupCacheKey(market, q);
      const cached = lookupClientCache.get(key);
      if (cached && Date.now() - cached.at < LOOKUP_CLIENT_TTL_MS) {
        setLookup(cached.value);
        setLookupError(null);
        setLookupLoading(false);
        return;
      }

      // 本機價值選股列：立刻畫出 PE／EPS，不等 API／券商刮取
      let paintedInstant = false;
      const localRows = data?.rows ?? [];
      if (localRows.length) {
        const row = findLocalRow(localRows, q, market);
        if (row && data) {
          const instant = lookupFromLocalRow(row, data.ymd, data.date);
          setLookup(instant);
          setLookupError(null);
          paintedInstant = true;
          lookupClientCache.set(key, { at: Date.now(), value: instant });
          lookupClientCache.set(lookupCacheKey(market, row.code), {
            at: Date.now(),
            value: instant,
          });
        }
      }

      // 換查另一檔時立刻清掉舊卡，避免 A 的券商列掛在載入中的 B
      if (!paintedInstant) {
        setLookup(null);
      }

      lookupAbortRef.current?.abort();
      const ac = new AbortController();
      lookupAbortRef.current = ac;
      const seq = ++lookupSeqRef.current;
      setLookupLoading(true);
      setLookupError(null);
      try {
        const res = await fetch(
          `${apiBase}/value?q=${encodeURIComponent(q)}`,
          {
            cache: "no-store",
            signal: ac.signal,
          },
        );
        const json = (await res.json()) as {
          ok?: boolean;
          error?: string;
          lookup?: StockValueLookup;
        };
        if (ac.signal.aborted || seq !== lookupSeqRef.current) return;
        if (!res.ok || json.ok === false || !json.lookup) {
          throw new Error(json.error || "查無此股");
        }
        setLookup(json.lookup);
        lookupClientCache.set(key, { at: Date.now(), value: json.lookup });
        lookupClientCache.set(lookupCacheKey(market, json.lookup.code), {
          at: Date.now(),
          value: json.lookup,
        });
      } catch (e) {
        if (ac.signal.aborted || seq !== lookupSeqRef.current) return;
        // 已有本機即時結果時保留畫面
        if (!lookupClientCache.has(key)) {
          setLookup(null);
          setLookupError(e instanceof Error ? e.message : "查詢失敗");
        }
      } finally {
        if (!ac.signal.aborted && seq === lookupSeqRef.current) {
          setLookupLoading(false);
        }
      }
    },
    [query, data, data?.rows, data?.ymd, data?.date, market, apiBase],
  );

  useEffect(() => {
    return () => {
      lookupAbortRef.current?.abort();
    };
  }, []);

  const rows = useMemo(() => {
    const list = [...(data?.rows ?? [])];
    list.sort((a, b) => {
      const d = sortValue(a, sortKey) - sortValue(b, sortKey);
      if (d !== 0) return asc ? d : -d;
      return b.epsYoy - a.epsYoy;
    });
    return list;
  }, [data?.rows, sortKey, asc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setAsc((v) => !v);
    else {
      setSortKey(key);
      setAsc(key === "forwardPe");
    }
  };

  const toggleExpand = (code: string) => {
    setExpanded((cur) => (cur === code ? null : code));
  };

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) {
      return <ArrowUpDown className="ml-0.5 inline size-3 opacity-40" />;
    }
    return asc ? (
      <ArrowUp className="ml-0.5 inline size-3" />
    ) : (
      <ArrowDown className="ml-0.5 inline size-3" />
    );
  };

  const minYoy = data?.criteria.minEpsYoy ?? defaultMinYoy;
  const maxPe = data?.criteria.maxForwardPe ?? defaultMaxPe;
  const minAmt = data?.criteria.minDayAmtYi ?? defaultMinAmt;
  const amtUnit = market === "us" ? "億美元" : "億";
  const title = market === "us" ? "美股價值選股" : "價值選股";
  const backLabel = market === "us" ? "回美股資金流" : "回資金流";
  const lookupPlaceholder =
    market === "us"
      ? "查詢單一股票（代號或名稱，如 AAPL／蘋果／NVDA）"
      : "查詢單一股票（代號或名稱，如 2330／台積電）";
  const emptyListMsg =
    data?.emptyReason ||
    (market === "us"
      ? `目前沒有同時符合「明年 EPS YoY > ${minYoy}%」、「前瞻本益比 < ${maxPe}」與「成交 ≥ ${minAmt} ${amtUnit}」的標的。`
      : `目前沒有同時符合「明年 EPS YoY > ${minYoy}%」、「前瞻本益比 < ${maxPe}」與「成交 ≥ ${minAmt} 億」的標的。`);

  return (
    <div className="relative min-h-full flex-1 pb-20 md:pb-6">
      <div
        className="studio-atmosphere pointer-events-none absolute inset-0"
        aria-hidden
      />
      <div className="relative z-10 mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href={homeHref}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            {backLabel}
          </Link>
          <div className="flex items-center gap-2">
            {market === "us" ? <MarketSwitch /> : null}
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={loading || refreshing}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border/50 bg-muted/30 px-3 py-2 text-xs font-medium transition hover:bg-muted/60 disabled:opacity-50"
            >
              <RefreshCw
                className={cn(
                  "size-3.5",
                  (loading || refreshing) && "animate-spin",
                )}
              />
              重新篩選
            </button>
          </div>
        </div>

        <h1 className="mt-4 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          篩選明年 EPS 年增率（
          {market === "us" ? "Nasdaq／Yahoo 共識" : "多家法人預估中位數"}
          ）大於 {minYoy}%，前瞻本益比（股價 ÷ 明年 EPS
          {market === "us" ? "" : "中位數"}
          ）低於 {maxPe}，且當日成交金額達 {minAmt} {amtUnit}
          以上的個股。
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {market === "us"
            ? "EPS 來源：Nasdaq yearly forecast／Yahoo earningsTrend；展開列顯示券商目標價與預估 EPS（USD）"
            : "EPS 來源：Cnyes／FactSet 法人共識中位數（篩選用）；展開列顯示內外資券商目標價與預估 EPS"}
          {data?.note ? ` · ${data.note}` : ""}
          {data?.date ? ` · 行情日 ${data.date}` : ""}
          {data?.scanned != null ? ` · 掃描 ${data.scanned} 檔` : ""}
          {data?.builtAt
            ? ` · 更新 ${new Date(data.builtAt).toLocaleString("zh-TW", { hour12: false })}`
            : ""}
          {fromCache ? " · 本機快取" : ""}
        </p>
        {market === "us" ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            美股門檻相對台股放寬（YoY {minYoy}%／PE{" "}
            {maxPe}／成交 {minAmt}
            億美元），以涵蓋流動中大型；欄位與台股價值選股對齊，即使通過檔數較少仍顯示明年／今年
            EPS。
          </p>
        ) : null}

        {/* 單股查詢：僅在按「查詢」時觸發 */}
        <form
          className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center"
          onSubmit={(e) => {
            e.preventDefault();
            void runLookup();
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={lookupPlaceholder}
              className="w-full rounded-xl border border-border/50 bg-[var(--panel)]/80 py-2.5 pl-9 pr-3 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              aria-busy={lookupLoading}
            />
          </div>
          <button
            type="submit"
            disabled={!query.trim()}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border/50 bg-muted/30 px-4 py-2.5 text-xs font-medium transition hover:bg-muted/60 disabled:opacity-50"
          >
            {lookupLoading ? "更新中…" : "查詢"}
          </button>
        </form>

        {lookupError ? (
          <p className="mt-2 text-sm text-[var(--mk-ebb)]">{lookupError}</p>
        ) : null}

        {lookup ? (
          <div className="mt-3 rounded-xl border border-border/50 bg-[var(--panel)]/80 p-3.5 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-medium">
                  {lookup.name}{" "}
                  <span className="tabular-nums text-muted-foreground">
                    {lookup.code}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {lookup.close.toFixed(lookup.close >= 100 ? 0 : 2)}
                  <span className={cn("ml-1.5", signedClass(lookup.changePct))}>
                    {formatPct(lookup.changePct)}
                  </span>
                  {" · 成交 "}
                  {fmtTurnover(lookup.dayAmt, market)}
                  {lookup.passesScreen ? (
                    <span className="ml-1.5 text-[var(--mk-up)]">符合篩選</span>
                  ) : (
                    <span className="ml-1.5">未列入篩選名單</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setLookup(null);
                  setQuery("");
                }}
                className="text-[11px] text-muted-foreground hover:text-foreground"
              >
                清除
              </button>
            </div>
            <FundMetricsGrid
              className="mt-3"
              forwardPe={lookup.forwardPe}
              nextYearEps={lookup.nextYearEps}
              baseEps={lookup.baseEps}
              epsYoy={lookup.epsYoy}
            />
            <BrokerTargetsDetail
              key={`${market}-${lookup.code}`}
              className="mt-3"
              code={lookup.code}
              name={lookup.name}
              market={market}
              defaultOpen
              prefetch
            />
          </div>
        ) : null}

        {loading && !rows.length ? (
          <p className="mt-10 text-center text-sm text-muted-foreground">
            正在篩選符合條件的個股…
          </p>
        ) : error && !rows.length ? (
          <div className="mt-10 text-center">
            <p className="text-sm text-[var(--mk-ebb)]">{error}</p>
            <button
              type="button"
              onClick={() => void load(true)}
              className="mt-3 border border-border px-3 py-1.5 text-xs transition hover:bg-muted/50"
            >
              再試一次
            </button>
          </div>
        ) : !rows.length ? (
          <p className="mt-10 text-center text-sm text-muted-foreground">
            {emptyListMsg}
          </p>
        ) : (
          <>
            <p className="mt-5 text-xs text-muted-foreground">
              共 {rows.length} 檔 · 點列可展開券商報告（目標價／EPS） · 點欄位可排序
            </p>

            {/* 手機卡片 */}
            <ul className="mt-3 space-y-2 md:hidden">
              {rows.map((r) => {
                const open = expanded === r.code;
                return (
                  <li
                    key={r.code}
                    className="rounded-xl border border-border/50 bg-[var(--panel)]/70 p-3.5"
                  >
                    <button
                      type="button"
                      onClick={() => toggleExpand(r.code)}
                      className="flex w-full items-start justify-between gap-3 text-left"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {r.rank}.
                          </span>
                          <span className="shrink-0 font-medium tabular-nums">
                            {r.code}
                          </span>
                        </div>
                        {market === "us" ? (
                          <UsStockName
                            code={r.code}
                            nameEn={r.nameEn}
                            nameZh={r.nameZh}
                            name={r.name}
                            variant="stack"
                            className="mt-0.5"
                          />
                        ) : (
                          <div className="mt-0.5 truncate font-medium">
                            {r.name}
                          </div>
                        )}
                        <div className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                          {r.close.toFixed(r.close >= 100 ? 0 : 2)}
                          <span
                            className={cn("ml-1.5", signedClass(r.changePct))}
                          >
                            {formatPct(r.changePct)}
                          </span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 text-right text-[11px]">
                        <div>
                          <div className="text-muted-foreground">EPS YoY</div>
                          <div className="font-semibold tabular-nums text-[var(--mk-up)]">
                            +{r.epsYoy.toFixed(1)}%
                          </div>
                        </div>
                        <ChevronDown
                          className={cn(
                            "size-4 text-muted-foreground transition",
                            open && "rotate-180",
                          )}
                        />
                      </div>
                    </button>
                    <FundMetricsGrid
                      className="mt-3"
                      forwardPe={r.forwardPe}
                      nextYearEps={r.nextYearEps}
                      baseEps={r.baseEps}
                      epsYoy={r.epsYoy}
                    />
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      成交 {fmtTurnover(r.dayAmt, market)}
                    </div>
                    {open ? (
                      <BrokerTargetsDetail
                        key={`${market}-${r.code}`}
                        className="mt-3"
                        code={r.code}
                        name={r.name}
                        market={market}
                        defaultOpen
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>

            {/* 桌面表格 */}
            <div className="mt-3 hidden overflow-x-auto rounded-xl border border-border/50 bg-[var(--panel)]/70 md:block">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border/50 text-left text-[11px] text-muted-foreground">
                    <th className="px-3 py-2.5 font-medium">#</th>
                    <th className="px-3 py-2.5 font-medium">代號／名稱</th>
                    <th className="px-3 py-2.5 text-right font-medium">
                      <button type="button" onClick={() => toggleSort("close")}>
                        股價
                        <SortIcon k="close" />
                      </button>
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium">
                      <button
                        type="button"
                        onClick={() => toggleSort("changePct")}
                      >
                        漲跌
                        <SortIcon k="changePct" />
                      </button>
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium">
                      <button type="button" onClick={() => toggleSort("epsYoy")}>
                        明年 EPS YoY
                        <SortIcon k="epsYoy" />
                      </button>
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium">
                      明年／今年 EPS
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium">
                      <button
                        type="button"
                        onClick={() => toggleSort("forwardPe")}
                      >
                        前瞻本益比
                        <SortIcon k="forwardPe" />
                      </button>
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium">
                      <button type="button" onClick={() => toggleSort("dayAmt")}>
                        成交
                        <SortIcon k="dayAmt" />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const open = expanded === r.code;
                    return (
                      <Fragment key={r.code}>
                        <tr
                          className="cursor-pointer border-t border-border/40 transition hover:bg-muted/30"
                          onClick={() => toggleExpand(r.code)}
                        >
                          <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                            {r.rank}
                          </td>
                          <td className="px-3 py-2.5">
                            {market === "us" ? (
                              <div className="flex items-start gap-1.5">
                                <div className="min-w-0 flex-1">
                                  <div className="font-medium tabular-nums">
                                    {r.code}
                                  </div>
                                  <UsStockName
                                    code={r.code}
                                    nameEn={r.nameEn}
                                    nameZh={r.nameZh}
                                    name={r.name}
                                    variant="stack"
                                    emphasize={false}
                                    className="text-[11px] text-muted-foreground"
                                  />
                                </div>
                                <ChevronDown
                                  className={cn(
                                    "mt-0.5 size-3.5 shrink-0 text-muted-foreground transition",
                                    open && "rotate-180",
                                  )}
                                />
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center gap-1.5 font-medium">
                                  {r.name}
                                  <ChevronDown
                                    className={cn(
                                      "size-3.5 text-muted-foreground transition",
                                      open && "rotate-180",
                                    )}
                                  />
                                </div>
                                <div className="text-[11px] tabular-nums text-muted-foreground">
                                  {r.code}
                                </div>
                              </>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            {r.close.toFixed(r.close >= 100 ? 0 : 2)}
                          </td>
                          <td
                            className={cn(
                              "px-3 py-2.5 text-right tabular-nums",
                              signedClass(r.changePct),
                            )}
                          >
                            {formatPct(r.changePct)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-[var(--mk-up)]">
                            +{r.epsYoy.toFixed(1)}%
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                            {r.nextYearEps.toFixed(2)} / {r.baseEps.toFixed(2)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                            {r.forwardPe.toFixed(1)}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            {fmtTurnover(r.dayAmt, market)}
                          </td>
                        </tr>
                        {open ? (
                          <tr className="border-t border-border/20 bg-muted/20">
                            <td colSpan={8} className="px-3 py-3">
                              <BrokerTargetsDetail
                                key={`${market}-${r.code}`}
                                code={r.code}
                                name={r.name}
                                market={market}
                                defaultOpen
                              />
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
      </div>
    </div>
  );
}
