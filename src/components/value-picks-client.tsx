"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronDown, RefreshCw, Search } from "lucide-react";
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
import { UsStockName } from "@/components/us-stock-name";
import { AppShell } from "@/components/app-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { ActionButton } from "@/components/ui/action-button";
import { Amount } from "@/components/ui/amount";
import { Chip, RankSlot, SortHeaderButton, type SortState } from "@/components/ui/chip";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";

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
    market === "us" ? `${CLIENT_CACHE_KEYS.value}:us` : CLIENT_CACHE_KEYS.value;
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
    market === "us" ? `${CLIENT_CACHE_KEYS.value}:us` : CLIENT_CACHE_KEYS.value;
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
        const res = await fetch(`${apiBase}/value?q=${encodeURIComponent(q)}`, {
          cache: "no-store",
          signal: ac.signal,
        });
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

  const sortState = (key: SortKey): SortState =>
    sortKey === key ? (asc ? "asc" : "desc") : "none";

  const toggleExpand = (code: string) => {
    setExpanded((cur) => (cur === code ? null : code));
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
    `目前沒有同時符合「明年 EPS YoY > ${minYoy}%」、「前瞻本益比 < ${maxPe}」與「成交 ≥ ${minAmt} ${amtUnit}」的標的。`;

  return (
    <AppShell
      market={market}
      width="default"
      back={{ href: homeHref, label: backLabel }}
      eyebrow={market === "us" ? "US VALUE SCREEN" : "VALUE SCREEN"}
      title={title}
      description={
        <>
          篩選明年 EPS 年增率（
          {market === "us" ? "Nasdaq／Yahoo 共識" : "多家法人預估中位數"}）大於{" "}
          {minYoy}%，前瞻本益比（股價 ÷ 明年 EPS
          {market === "us" ? "" : "中位數"}）低於 {maxPe}，且當日成交金額達{" "}
          {minAmt} {amtUnit} 以上的個股。
        </>
      }
      meta={
        <>
          {market === "us"
            ? "EPS 來源：Nasdaq yearly forecast／Yahoo earningsTrend"
            : "EPS 來源：Cnyes／FactSet 法人共識中位數"}
          {data?.note ? ` · ${data.note}` : ""}
          {data?.date ? ` · 行情日 ${data.date}` : ""}
          {data?.scanned != null ? ` · 掃描 ${data.scanned} 檔` : ""}
          {data?.builtAt
            ? ` · 更新 ${new Date(data.builtAt).toLocaleString("zh-TW", { hour12: false })}`
            : ""}
          {fromCache ? " · 本機快取" : ""}
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
          重新篩選
        </ActionButton>
      }
    >
      <div className="flex flex-wrap gap-2">
        <Chip tone="outline">EPS YoY &gt; {minYoy}%</Chip>
        <Chip tone="outline">前瞻 PE &lt; {maxPe}</Chip>
        <Chip tone="outline">
          成交 ≥ {minAmt} {amtUnit}
        </Chip>
        {market === "us" ? (
          <Chip tone="outline">門檻較台股放寬以涵蓋流動中大型</Chip>
        ) : null}
      </div>

      {/* 單股查詢：僅在按「查詢」時觸發 */}
      <Panel padded>
        <PanelHeader
          eyebrow="LOOKUP"
          title="查詢單一股票"
          description="不限於上方名單；會顯示前瞻本益比、明年／今年 EPS 與逐家券商目標價。"
        />
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center"
          onSubmit={(e) => {
            e.preventDefault();
            void runLookup();
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={lookupPlaceholder}
              aria-label="股票代號或名稱"
              className="min-h-11 w-full rounded-lg border border-line bg-sunken pr-3 pl-10 text-sm placeholder:text-muted-foreground focus-visible:border-[var(--mk-anchor)]"
              aria-busy={lookupLoading}
            />
          </div>
          <ActionButton
            type="submit"
            variant="solid"
            disabled={!query.trim()}
            className="sm:w-28"
          >
            {lookupLoading ? "更新中…" : "查詢"}
          </ActionButton>
        </form>

        {lookupError ? (
          <p className="mt-2 text-sm text-[var(--mk-ebb)]">{lookupError}</p>
        ) : null}

        {lookup ? (
          <div className="mt-3 rounded-lg border border-line bg-sunken p-3 sm:p-3.5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="t-label">
                  {lookup.name}{" "}
                  <span className="num font-normal text-muted-foreground">
                    {lookup.code}
                  </span>
                </p>
                <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                  <span className="num text-foreground/80">
                    {lookup.close.toFixed(lookup.close >= 100 ? 0 : 2)}
                  </span>
                  <span className={cn("num", signedClass(lookup.changePct))}>
                    {formatPct(lookup.changePct)}
                  </span>
                  <span>
                    成交{" "}
                    <Amount
                      text={fmtTurnover(lookup.dayAmt, market)}
                      className="text-foreground/80"
                    />
                  </span>
                  <span
                    className={
                      lookup.passesScreen ? "text-[var(--mk-up)]" : undefined
                    }
                  >
                    {lookup.passesScreen ? "符合篩選" : "未列入篩選名單"}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setLookup(null);
                  setQuery("");
                }}
                className="t-meta inline-flex min-h-8 items-center rounded-md px-1.5 hover:text-foreground"
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
      </Panel>

      {loading && !rows.length ? (
        <Panel>
          <LoadingState label="正在篩選符合條件的個股…" />
        </Panel>
      ) : error && !rows.length ? (
        <Panel>
          <ErrorState
            description={error}
            action={
              <ActionButton size="sm" onClick={() => void load(true)}>
                再試一次
              </ActionButton>
            }
          />
        </Panel>
      ) : !rows.length ? (
        <Panel>
          <EmptyState title="目前沒有符合條件的標的" description={emptyListMsg} />
        </Panel>
      ) : (
        <section className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="t-kicker">
              <span className="t-eyebrow mr-1.5">SCREEN RESULT</span>
              {rows.length} 檔
            </p>
            <p className="t-meta hidden sm:block">
              點列可展開券商報告（目標價／EPS）
            </p>
          </div>

          {/* 手機卡片 */}
          <ul className="space-y-2 md:hidden">
            {rows.map((r) => {
              const open = expanded === r.code;
              return (
                <li key={r.code} className="surface overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleExpand(r.code)}
                    aria-expanded={open}
                    className="flex w-full items-start gap-3 px-3 py-3 text-left"
                  >
                    <RankSlot rank={r.rank} emphasis className="pt-0.5" />
                    <div className="min-w-0 flex-1">
                      {market === "us" ? (
                        <>
                          <p className="num text-[0.9375rem] font-semibold">
                            {r.code}
                          </p>
                          <UsStockName
                            code={r.code}
                            nameEn={r.nameEn}
                            nameZh={r.nameZh}
                            name={r.name}
                            variant="compact"
                            emphasize={false}
                            className="mt-0.5 block text-xs text-muted-foreground"
                          />
                        </>
                      ) : (
                        <>
                          <p className="truncate text-[0.9375rem] font-medium">
                            {r.name}
                          </p>
                          <p className="num text-xs text-muted-foreground">
                            {r.code}
                          </p>
                        </>
                      )}
                      <p className="mt-1 flex flex-wrap items-baseline gap-x-2.5 text-xs text-muted-foreground">
                        <span className="num text-foreground/80">
                          {r.close.toFixed(r.close >= 100 ? 0 : 2)}
                        </span>
                        <span className={cn("num", signedClass(r.changePct))}>
                          {formatPct(r.changePct)}
                        </span>
                        <span>
                          成交{" "}
                          <Amount
                            text={fmtTurnover(r.dayAmt, market)}
                            className="text-foreground/80"
                          />
                        </span>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-start gap-2 text-right">
                      <div>
                        <p className="t-kicker">EPS YoY</p>
                        <p className="num text-[0.9375rem] font-semibold text-[var(--mk-up)]">
                          +{r.epsYoy.toFixed(1)}%
                        </p>
                      </div>
                      <ChevronDown
                        className={cn(
                          "mt-1 size-4 text-muted-foreground transition-transform",
                          open && "rotate-180",
                        )}
                        aria-hidden
                      />
                    </div>
                  </button>
                  <div className="px-3 pb-3">
                    <FundMetricsGrid
                      omitYoy
                      forwardPe={r.forwardPe}
                      nextYearEps={r.nextYearEps}
                      baseEps={r.baseEps}
                      epsYoy={r.epsYoy}
                    />
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
                  </div>
                </li>
              );
            })}
          </ul>

          {/* 桌面表格 */}
          <Panel className="hidden overflow-hidden md:block">
            <div className="scroll-x">
              <table className="data-table min-w-[760px]">
                <thead>
                  <tr>
                    <th className="w-10 text-right">#</th>
                    <th>代號／名稱</th>
                    <th className="cell-num">
                      <SortHeaderButton
                        state={sortState("close")}
                        onClick={() => toggleSort("close")}
                      >
                        股價
                      </SortHeaderButton>
                    </th>
                    <th className="cell-num">
                      <SortHeaderButton
                        state={sortState("changePct")}
                        onClick={() => toggleSort("changePct")}
                      >
                        漲跌
                      </SortHeaderButton>
                    </th>
                    <th className="cell-num">
                      <SortHeaderButton
                        state={sortState("epsYoy")}
                        onClick={() => toggleSort("epsYoy")}
                      >
                        明年 EPS YoY
                      </SortHeaderButton>
                    </th>
                    <th className="cell-num">明年／今年 EPS</th>
                    <th className="cell-num">
                      <SortHeaderButton
                        state={sortState("forwardPe")}
                        onClick={() => toggleSort("forwardPe")}
                      >
                        前瞻本益比
                      </SortHeaderButton>
                    </th>
                    <th className="cell-num">
                      <SortHeaderButton
                        state={sortState("dayAmt")}
                        onClick={() => toggleSort("dayAmt")}
                      >
                        成交
                      </SortHeaderButton>
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
                          onClick={() => toggleExpand(r.code)}
                        >
                          <td className="num text-right text-muted-foreground">
                            {r.rank}
                          </td>
                          <td>
                            {market === "us" ? (
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="num font-medium">{r.code}</span>
                                  <ChevronDown
                                    className={cn(
                                      "size-3.5 shrink-0 text-muted-foreground transition-transform",
                                      open && "rotate-180",
                                    )}
                                    aria-hidden
                                  />
                                </div>
                                <UsStockName
                                  code={r.code}
                                  nameEn={r.nameEn}
                                  nameZh={r.nameZh}
                                  name={r.name}
                                  variant="stack"
                                  emphasize={false}
                                  className="text-[0.6875rem] text-muted-foreground"
                                />
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center gap-1.5 font-medium">
                                  {r.name}
                                  <ChevronDown
                                    className={cn(
                                      "size-3.5 text-muted-foreground transition-transform",
                                      open && "rotate-180",
                                    )}
                                    aria-hidden
                                  />
                                </div>
                                <div className="num text-[0.6875rem] text-muted-foreground">
                                  {r.code}
                                </div>
                              </>
                            )}
                          </td>
                          <td className="cell-num">
                            {r.close.toFixed(r.close >= 100 ? 0 : 2)}
                          </td>
                          <td className={cn("cell-num", signedClass(r.changePct))}>
                            {formatPct(r.changePct)}
                          </td>
                          <td className="cell-num font-semibold text-[var(--mk-up)]">
                            +{r.epsYoy.toFixed(1)}%
                          </td>
                          <td className="cell-num text-muted-foreground">
                            {r.nextYearEps.toFixed(2)} / {r.baseEps.toFixed(2)}
                          </td>
                          <td className="cell-num font-medium">
                            {r.forwardPe.toFixed(1)}
                          </td>
                          <td className="cell-num">
                            <Amount text={fmtTurnover(r.dayAmt, market)} />
                          </td>
                        </tr>
                        {open ? (
                          <tr className="bg-sunken">
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
          </Panel>
        </section>
      )}
    </AppShell>
  );
}
