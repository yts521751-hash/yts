/**
 * 美股市場適配層（與 tw-market 分離命名空間）。
 * - 本機／R2 快取前綴：`us/`（不與台股日檔混放）
 * - 時區：America/New_York
 * - 報價來源：Yahoo Finance chart（公開／免金鑰）
 */

import { readdir } from "fs/promises";
import path from "path";
import {
  getCacheDir,
  parseNumber,
  readCacheFile,
  toYmd,
  writeCacheFile,
  ymdToIso,
  type QuoteRow,
} from "@/lib/tw-market";
import { listUsWatchCodes } from "@/lib/us-sector-universe";

const UA =
  "Mozilla/5.0 (compatible; JinLiu-US/1.0; +https://jinliu-board.onrender.com; research)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 所有美股快取檔名前綴（R2 key 亦同：jinliu-cache/us/...） */
export const US_CACHE_PREFIX = "us/";

export const US_ACTIVE_FLOW_CACHE = `${US_CACHE_PREFIX}flow-active.json`;
export const US_STAGING_FLOW_CACHE = `${US_CACHE_PREFIX}flow-staging.json`;
export const US_LAST_CLOSE_FLOW_CACHE = `${US_CACHE_PREFIX}flow-last-close.json`;
export const US_DEPLOY_META_CACHE = `${US_CACHE_PREFIX}deploy-meta.json`;
export const US_DAILY_CLOSE_META = `${US_CACHE_PREFIX}daily-close-meta.json`;
export const US_STOCKS_FLOW_CACHE = `${US_CACHE_PREFIX}flow-stocks-latest.json`;
export const US_TURNOVER_CACHE = `${US_CACHE_PREFIX}turnover-ranking-latest.json`;
export const US_VALUE_CACHE = `${US_CACHE_PREFIX}value-picks-latest.json`;
export const US_MA_SCREENER_CACHE = `${US_CACHE_PREFIX}ma-screener-active.json`;
export const US_WIND_CACHE = `${US_CACHE_PREFIX}wind-gauge-latest.json`;

export const US_HISTORY_TRADING_DAYS = 60;
export const US_HISTORY_CALENDAR_LOOKBACK = 130;
export const US_DATA_PROVENANCE = "yahoo+public";

export type UsQuoteRow = QuoteRow & {
  /** 成交股數（相對成交量用） */
  volume?: number;
};

export type UsDayQuoteCache = {
  ymd: string;
  quotes: UsQuoteRow[];
  indexChangePct: number | null;
  fetchedAt: string;
  source: typeof US_DATA_PROVENANCE;
};

export type UsDeployMeta = {
  syncing: boolean;
  lastPromoteAt: string | null;
  lastBuildAt: string | null;
  lastError: string | null;
  activeBuiltAt: string | null;
  stagingBuiltAt: string | null;
};

type ChartBar = {
  ymd: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  changePct: number;
  turnover: number;
};

function usPath(name: string) {
  return name.startsWith(US_CACHE_PREFIX) ? name : `${US_CACHE_PREFIX}${name}`;
}

export function usQuotesCacheName(ymd: string) {
  return usPath(`quotes-${ymd}.json`);
}

export function usKlineCacheName(sectorId: string) {
  return usPath(`kline-${sectorId}.json`);
}

export function usSymbolHistCacheName(symbol: string) {
  return usPath(`hist-${symbol.toUpperCase()}.json`);
}

export async function readUsCacheFile<T>(name: string): Promise<T | null> {
  return readCacheFile<T>(usPath(name.replace(/^us\//, "")));
}

export async function writeUsCacheFile(name: string, data: unknown) {
  return writeCacheFile(usPath(name.replace(/^us\//, "")), data);
}

/** 美東時鐘 */
export function nyClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(now);
  const get = (ty: string) => parts.find((p) => p.type === ty)?.value ?? "";
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  const weekday = get("weekday");
  const ymd = `${get("year")}${get("month")}${get("day")}`;
  const isWeekday = !["Sat", "Sun"].includes(weekday);
  const mins = hour * 60 + minute;
  return { hour, minute, mins, isWeekday, ymd, weekday };
}

/** 美股日終灰度：平日 18:00 ET 後才允許 staging→active */
export function shouldPromoteUsFlowToActive(force?: boolean) {
  if (force) return true;
  const { isWeekday, mins } = nyClock();
  return isWeekday && mins >= 18 * 60;
}

export { ymdToIso, toYmd };

async function fetchYahooChart(
  symbol: string,
  range = "6mo",
): Promise<ChartBar[] | null> {
  const hosts = [
    "https://query1.finance.yahoo.com",
    "https://query2.finance.yahoo.com",
  ];
  for (const host of hosts) {
    try {
      const url = `${host}/v8/finance/chart/${encodeURIComponent(
        symbol,
      )}?interval=1d&range=${encodeURIComponent(range)}&events=div%2Csplit`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "application/json,text/plain,*/*",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        chart?: {
          result?: Array<{
            meta?: { shortName?: string; symbol?: string };
            timestamp?: number[];
            indicators?: {
              quote?: Array<{
                open?: Array<number | null>;
                high?: Array<number | null>;
                low?: Array<number | null>;
                close?: Array<number | null>;
                volume?: Array<number | null>;
              }>;
            };
          }>;
        };
      };
      const result = data.chart?.result?.[0];
      const ts = result?.timestamp ?? [];
      const q = result?.indicators?.quote?.[0];
      const shortName = String(result?.meta?.shortName || "").trim();
      if (shortName) nameMemo.set(symbol.toUpperCase(), shortName);
      if (!ts.length || !q) continue;
      const bars: ChartBar[] = [];
      let prevClose = 0;
      for (let i = 0; i < ts.length; i++) {
        const close = Number(q.close?.[i] ?? 0);
        const open = Number(q.open?.[i] ?? close);
        const high = Number(q.high?.[i] ?? Math.max(open, close));
        const low = Number(q.low?.[i] ?? Math.min(open, close));
        const volume = Number(q.volume?.[i] ?? 0);
        if (!(close > 0)) continue;
        const changePct =
          prevClose > 0 ? ((close - prevClose) / prevClose) * 100 : 0;
        prevClose = close;
        const d = new Date(ts[i] * 1000);
        // Yahoo timestamps are UTC; US equity session date ≈ ET calendar date
        const ymd = toYmdNy(d);
        bars.push({
          ymd,
          open: open > 0 ? open : close,
          high: high > 0 ? high : close,
          low: low > 0 ? low : close,
          close,
          volume: volume > 0 ? volume : 0,
          changePct,
          turnover: close * Math.max(0, volume),
        });
      }
      if (bars.length >= 5) return bars;
    } catch {
      /* try next host */
    }
  }
  return null;
}

/** 用美東日曆把 UTC 時間戳轉成 YYYYMMDD（盤後日 K 對齊交易日） */
function toYmdNy(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (ty: string) => parts.find((p) => p.type === ty)?.value ?? "";
  return `${get("year")}${get("month")}${get("day")}`;
}

type SymbolHistCache = {
  symbol: string;
  name: string;
  bars: ChartBar[];
  fetchedAt: string;
};

const nameMemo = new Map<string, string>();

async function loadSymbolHistory(
  symbol: string,
  options?: { force?: boolean },
): Promise<SymbolHistCache | null> {
  const code = symbol.toUpperCase();
  const cacheName = usSymbolHistCacheName(code);
  if (!options?.force) {
    const cached = await readUsCacheFile<SymbolHistCache>(cacheName);
    if (cached?.bars?.length) {
      const age = Date.now() - Date.parse(cached.fetchedAt || "");
      // 盤中／日內可沿用 6h；日終 force 會重抓
      if (Number.isFinite(age) && age >= 0 && age < 6 * 60 * 60 * 1000) {
        if (cached.name) nameMemo.set(code, cached.name);
        return cached;
      }
    }
  }

  const bars = await fetchYahooChart(code, "6mo");
  if (!bars?.length) {
    const stale = await readUsCacheFile<SymbolHistCache>(cacheName);
    return stale?.bars?.length ? stale : null;
  }
  const name = nameMemo.get(code) || code;
  const bundle: SymbolHistCache = {
    symbol: code,
    name,
    bars,
    fetchedAt: new Date().toISOString(),
  };
  await writeUsCacheFile(cacheName, bundle);
  return bundle;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, Math.max(1, items.length)) },
      async () => {
        while (i < items.length) {
          const idx = i++;
          out[idx] = await fn(items[idx]);
          await sleep(80);
        }
      },
    ),
  );
  return out;
}

export type SyncUsQuotesResult = {
  days: string[];
  /** 實際打 Yahoo 的代號數（0＝完全沿用本機／R2） */
  fetchedSymbols: number;
  skippedSymbols: number;
  /** 水位是否已涵蓋目標交易日 */
  coveredTarget: boolean;
  target: string;
  watermark: string | null;
  /** 本次是否寫入／合併了日檔 */
  wroteDays: boolean;
};

/**
 * 從宇宙成分 Yahoo 日 K 組裝 us/quotes-YYYYMMDD.json。
 * 回傳寫入／更新的交易日（新→舊）。
 *
 * 增量行為（force=false）：
 * - 最新日檔已涵蓋 target 且宇宙代號齊 → 略過網路，直接回傳既有日清單
 * - 僅缺少數新宇宙代號 → 只抓缺碼並 merge 進既有日檔（不覆蓋掉舊成分）
 * - 水位落後 target → 重抓全宇宙組日檔
 */
export async function syncUsQuoteDays(options?: {
  force?: boolean;
  symbols?: string[];
  /** YYYYMMDD；預設用美東同步目標日 */
  targetYmd?: string;
  onProgress?: (done: number, total: number, label?: string) => void;
}): Promise<string[]> {
  const result = await ensureUsQuotesUpToDate(options);
  return result.days;
}

export async function ensureUsQuotesUpToDate(options?: {
  force?: boolean;
  symbols?: string[];
  targetYmd?: string;
  onProgress?: (done: number, total: number, label?: string) => void;
}): Promise<SyncUsQuotesResult> {
  const { resolveUsSyncTargetYmd } = await import("@/lib/gap-sync-us");
  const symbols = (options?.symbols ?? listUsWatchCodes()).map((s) =>
    s.toUpperCase(),
  );
  const target = options?.targetYmd ?? resolveUsSyncTargetYmd();
  const existingDays = await listUsCachedTradingDays(US_HISTORY_TRADING_DAYS);
  const watermark = existingDays[0] ?? null;

  if (!options?.force && watermark && watermark >= target) {
    const latestQuotes = await getUsCachedDayQuotes(watermark);
    const have = new Set(
      [...(latestQuotes?.keys() ?? [])].map((c) => c.toUpperCase()),
    );
    const missing = symbols.filter((s) => !have.has(s));
    // 宇宙幾乎齊（允許少數 Yahoo 失敗）：略過全量重抓
    if (missing.length === 0) {
      options?.onProgress?.(symbols.length, symbols.length, "quotes-cached");
      return {
        days: existingDays,
        fetchedSymbols: 0,
        skippedSymbols: symbols.length,
        coveredTarget: true,
        target,
        watermark,
        wroteDays: false,
      };
    }
    if (missing.length <= Math.max(8, Math.ceil(symbols.length * 0.15))) {
      const merged = await mergeMissingUsSymbols(missing, {
        force: true,
        onProgress: options?.onProgress,
      });
      return {
        days: merged.days.length ? merged.days : existingDays,
        fetchedSymbols: missing.length,
        skippedSymbols: symbols.length - missing.length,
        coveredTarget: true,
        target,
        watermark: merged.days[0] ?? watermark,
        wroteDays: merged.wroteDays,
      };
    }
  }

  const full = await fetchAndWriteUsQuoteDays(symbols, {
    force: Boolean(options?.force) || Boolean(watermark && watermark < target),
    onProgress: options?.onProgress,
  });
  const days = full.days;
  const newWatermark = days[0] ?? null;
  return {
    days,
    fetchedSymbols: symbols.length,
    skippedSymbols: 0,
    coveredTarget: Boolean(newWatermark && newWatermark >= target),
    target,
    watermark: newWatermark,
    wroteDays: days.length > 0,
  };
}

/** 只抓缺碼並 merge 進既有 us/quotes-*（保留舊宇宙） */
async function mergeMissingUsSymbols(
  missing: string[],
  options?: {
    force?: boolean;
    onProgress?: (done: number, total: number, label?: string) => void;
  },
): Promise<{ days: string[]; wroteDays: boolean }> {
  const byDay = new Map<string, Map<string, UsQuoteRow>>();
  let done = 0;
  await mapPool(missing, 5, async (sym) => {
    const hist = await loadSymbolHistory(sym, { force: options?.force });
    done++;
    options?.onProgress?.(done, missing.length, sym);
    if (!hist?.bars?.length) return;
    for (const b of hist.bars) {
      let dayMap = byDay.get(b.ymd);
      if (!dayMap) {
        dayMap = new Map();
        byDay.set(b.ymd, dayMap);
      }
      dayMap.set(sym, {
        code: sym,
        name: hist.name || sym,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        changePct: b.changePct,
        turnover: b.turnover,
        volume: b.volume,
      });
    }
  });

  const touchDays = [...byDay.keys()].sort((a, b) => b.localeCompare(a));
  let wrote = false;
  for (const ymd of touchDays) {
    const incoming = byDay.get(ymd);
    if (!incoming?.size) continue;
    const prev = await readUsCacheFile<UsDayQuoteCache>(usQuotesCacheName(ymd));
    const map = new Map<string, UsQuoteRow>();
    for (const q of prev?.quotes ?? []) {
      map.set(q.code.toUpperCase(), { ...q, code: q.code.toUpperCase() });
    }
    for (const [code, q] of incoming) {
      map.set(code.toUpperCase(), q);
    }
    if (map.size < 10) continue;
    const bundle: UsDayQuoteCache = {
      ymd,
      quotes: [...map.values()],
      indexChangePct: prev?.indexChangePct ?? null,
      fetchedAt: new Date().toISOString(),
      source: US_DATA_PROVENANCE,
    };
    await writeUsCacheFile(usQuotesCacheName(ymd), bundle);
    wrote = true;
  }
  if (wrote) {
    invalidateUsTradingDaysMemo();
    invalidateUsDayQuotesMemo();
  }
  const days = await listUsCachedTradingDays(US_HISTORY_TRADING_DAYS);
  return { days, wroteDays: wrote };
}

async function fetchAndWriteUsQuoteDays(
  symbols: string[],
  options?: {
    force?: boolean;
    onProgress?: (done: number, total: number, label?: string) => void;
  },
): Promise<{ days: string[] }> {
  const byDay = new Map<string, Map<string, UsQuoteRow>>();

  let done = 0;
  await mapPool(symbols, 5, async (sym) => {
    const hist = await loadSymbolHistory(sym, { force: options?.force });
    done++;
    options?.onProgress?.(done, symbols.length, sym);
    if (!hist?.bars?.length) return;
    for (const b of hist.bars) {
      let dayMap = byDay.get(b.ymd);
      if (!dayMap) {
        dayMap = new Map();
        byDay.set(b.ymd, dayMap);
      }
      dayMap.set(sym, {
        code: sym,
        name: hist.name || sym,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        changePct: b.changePct,
        turnover: b.turnover,
        volume: b.volume,
      });
    }
  });

  // S&P 500 指數漲跌（風度／情緒）
  const indexByYmd = new Map<string, number>();
  try {
    const spx = await fetchYahooChart("^GSPC", "6mo");
    if (spx) {
      for (const b of spx) indexByYmd.set(b.ymd, b.changePct);
    }
  } catch {
    /* optional */
  }

  const days = [...byDay.keys()].sort((a, b) => b.localeCompare(a));
  for (const ymd of days) {
    const incoming = byDay.get(ymd);
    const quotesFromFetch = [...(incoming?.values() ?? [])];
    if (quotesFromFetch.length < 10) continue;

    // merge 舊日檔：避免 force 重抓時若少數代號失敗把舊成分洗掉
    const prev = await readUsCacheFile<UsDayQuoteCache>(usQuotesCacheName(ymd));
    const map = new Map<string, UsQuoteRow>();
    for (const q of prev?.quotes ?? []) {
      map.set(q.code.toUpperCase(), { ...q, code: q.code.toUpperCase() });
    }
    for (const q of quotesFromFetch) {
      map.set(q.code.toUpperCase(), q);
    }

    const bundle: UsDayQuoteCache = {
      ymd,
      quotes: [...map.values()],
      indexChangePct: indexByYmd.get(ymd) ?? prev?.indexChangePct ?? null,
      fetchedAt: new Date().toISOString(),
      source: US_DATA_PROVENANCE,
    };
    await writeUsCacheFile(usQuotesCacheName(ymd), bundle);
  }
  invalidateUsTradingDaysMemo();
  invalidateUsDayQuotesMemo();
  const written = days.filter((ymd) => (byDay.get(ymd)?.size ?? 0) >= 10);
  return { days: written };
}

let usTradingDaysMemo: { at: number; days: string[] } | null = null;
const usDayQuotesMemo = new Map<string, Map<string, UsQuoteRow>>();

export function invalidateUsTradingDaysMemo() {
  usTradingDaysMemo = null;
}

export function invalidateUsDayQuotesMemo(ymd?: string) {
  if (ymd) usDayQuotesMemo.delete(ymd);
  else usDayQuotesMemo.clear();
}

export async function listUsCachedTradingDays(
  need: number,
  _lookbackCalendar = US_HISTORY_CALENDAR_LOOKBACK,
): Promise<string[]> {
  const now = Date.now();
  if (
    usTradingDaysMemo &&
    now - usTradingDaysMemo.at < 60_000 &&
    usTradingDaysMemo.days.length >= need
  ) {
    return usTradingDaysMemo.days.slice(0, need);
  }

  try {
    const cacheDir = path.join(getCacheDir(), "us");
    const files = await readdir(/* turbopackIgnore: true */ cacheDir);
    const days = files
      .map((f) => /^quotes-(\d{8})\.json$/.exec(f)?.[1])
      .filter((ymd): ymd is string => Boolean(ymd))
      .sort((a, b) => b.localeCompare(a));
    if (days.length) {
      usTradingDaysMemo = { at: now, days };
      return days.slice(0, need);
    }
  } catch {
    /* fall through */
  }

  // 慢路徑：逐日探測
  const days: string[] = [];
  const cursor = new Date();
  cursor.setHours(12, 0, 0, 0);
  for (let i = 0; i < US_HISTORY_CALENDAR_LOOKBACK && days.length < need; i++) {
    const ymd = toYmdNy(cursor);
    const cached = await readUsCacheFile<UsDayQuoteCache>(usQuotesCacheName(ymd));
    if (cached?.quotes?.length) days.push(ymd);
    cursor.setDate(cursor.getDate() - 1);
  }
  usTradingDaysMemo = { at: now, days };
  return days.slice(0, need);
}

export async function getUsCachedDayQuotes(
  ymd: string,
): Promise<Map<string, UsQuoteRow> | null> {
  const hit = usDayQuotesMemo.get(ymd);
  if (hit?.size) return hit;
  const cached = await readUsCacheFile<UsDayQuoteCache>(usQuotesCacheName(ymd));
  if (!cached?.quotes?.length) return null;
  const map = new Map(cached.quotes.map((q) => [q.code.toUpperCase(), q]));
  if (usDayQuotesMemo.size > 120) {
    const first = usDayQuotesMemo.keys().next().value;
    if (first) usDayQuotesMemo.delete(first);
  }
  usDayQuotesMemo.set(ymd, map);
  return map;
}

export async function getUsLatestCachedTradingDay(): Promise<string | null> {
  const days = await listUsCachedTradingDays(1);
  return days[0] ?? null;
}

export async function getUsDayIndexChangePct(
  ymd: string,
): Promise<number | null> {
  const cached = await readUsCacheFile<UsDayQuoteCache>(usQuotesCacheName(ymd));
  return cached?.indexChangePct ?? null;
}

/**
 * 近 lookback 日（不含當日）平均成交金額；不足則 null。
 */
export function avgPriorTurnover(
  series: Array<{ turnover: number }>,
  index: number,
  lookback = 20,
): number | null {
  if (index <= 0) return null;
  const start = Math.max(0, index - lookback);
  const slice = series.slice(start, index);
  if (slice.length < 5) return null;
  const sum = slice.reduce((s, x) => s + Math.max(0, x.turnover), 0);
  const avg = sum / slice.length;
  return avg > 0 ? avg : null;
}

/**
 * 為某代號計算當日 rvol（相對近 20 日均成交金額）。
 * daysNewestFirst：交易日 ymd 新→舊；quotesByDay 已載入。
 */
export function computeRvolForCode(
  code: string,
  daysNewestFirst: string[],
  quotesByDay: Map<string, Map<string, UsQuoteRow>>,
  dayIndex = 0,
): number | null {
  const key = code.toUpperCase();
  const turnovers: number[] = [];
  for (let i = dayIndex; i < daysNewestFirst.length && turnovers.length < 21; i++) {
    const q = quotesByDay.get(daysNewestFirst[i])?.get(key);
    if (q && q.turnover > 0) turnovers.push(q.turnover);
  }
  if (turnovers.length < 6) return null;
  const today = turnovers[0];
  const prior = turnovers.slice(1);
  const avg = prior.reduce((a, b) => a + b, 0) / prior.length;
  if (!(avg > 0)) return null;
  return today / avg;
}

export async function readUsDeployMeta(): Promise<UsDeployMeta> {
  const meta = await readUsCacheFile<UsDeployMeta>(US_DEPLOY_META_CACHE);
  return (
    meta ?? {
      syncing: false,
      lastPromoteAt: null,
      lastBuildAt: null,
      lastError: null,
      activeBuiltAt: null,
      stagingBuiltAt: null,
    }
  );
}

export async function writeUsDeployMeta(patch: Partial<UsDeployMeta>) {
  const prev = await readUsDeployMeta();
  await writeUsCacheFile(US_DEPLOY_META_CACHE, { ...prev, ...patch });
}

export async function promoteUsStagingToActive() {
  const staging = await readUsCacheFile<unknown>(US_STAGING_FLOW_CACHE);
  if (!staging) throw new Error("美股 staging 快取不存在，無法切換");
  await writeUsCacheFile(US_ACTIVE_FLOW_CACHE, staging);
  await writeUsDeployMeta({
    lastPromoteAt: new Date().toISOString(),
    activeBuiltAt: new Date().toISOString(),
    syncing: false,
    lastError: null,
  });
}

/** ETF／ETN／權證粗篩（排行／金流用；成值宇宙另見 nasdaq-us screener 過濾） */
export function isUsCommonStock(code: string, name?: string): boolean {
  const c = code.toUpperCase();
  if (!/^[A-Z]{1,5}(\.[A-Z])?$/.test(c)) return false;
  // 常見槓桿／反向／商品 ETF
  if (/^(SQQQ|TQQQ|SPXU|SPXL|UVXY|VIXY|SOXL|SOXS|SPY|QQQ|IWM|DIA|VOO|IVV|HYG|TLT)$/.test(c)) {
    return false;
  }
  // 權證／單位後綴
  if (/(WS|WT|WW)$/.test(c)) return false;
  if (c.length >= 5 && /[WRU]$/.test(c)) return false;
  const n = (name || "").toUpperCase();
  // 用字界，避免誤傷含 FUND／TRUST 子字串的普通股名稱
  if (/\b(ETF|ETN|TRUST|FUND|WARRANT|RIGHTS?|UNITS?|PREFERRED)\b/.test(n)) {
    return false;
  }
  return true;
}

export function parseUsNumber(raw: unknown): number {
  return parseNumber(raw);
}
