import { mkdir, readdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";

const UA =
  "Mozilla/5.0 (compatible; JinChao/1.0; +https://localhost; research)";

export type QuoteRow = {
  code: string;
  name: string;
  open: number;
  high: number;
  low: number;
  close: number;
  changePct: number;
  /** 成交金額（元） */
  turnover: number;
};

/** 三大法人買賣超（股數，可為負） */
export type InstiRow = {
  code: string;
  name: string;
  foreign: number;
  trust: number;
  dealer: number;
  total: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export function toSlashDate(ymd: string): string {
  return `${ymd.slice(0, 4)}/${ymd.slice(4, 6)}/${ymd.slice(6, 8)}`;
}

export function toRocSlash(ymd: string): string {
  return `${Number(ymd.slice(0, 4)) - 1911}/${ymd.slice(4, 6)}/${ymd.slice(6, 8)}`;
}

export function ymdToIso(ymd: string): string {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

export function parseNumber(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  if (typeof raw !== "string") return 0;
  const cleaned = raw.replace(/,/g, "").replace(/\+/g, "").trim();
  if (!cleaned || cleaned === "--" || cleaned === "---") return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export async function fetchJson<T>(url: string, retries = 2): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "application/json,text/plain,*/*",
        },
        cache: "no-store",
      });
      if (!res.ok) {
        if (attempt === retries) return null;
        await sleep(400 * (attempt + 1));
        continue;
      }
      return (await res.json()) as T;
    } catch {
      if (attempt === retries) return null;
      await sleep(500 * (attempt + 1));
    }
  }
  return null;
}

export async function fetchJsonViaCurl<T>(url: string): Promise<T | null> {
  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const run = promisify(execFile);
    // 櫃買大量 JSON：http1.1＋壓縮＋重試較穩；傳輸中斷時 curl 可能 exit≠0，
    // 但仍可能已寫完整 body 在 stdout，需容錯解析。
    const args = [
      "-sS",
      "-k",
      "--http1.1",
      "--compressed",
      "--retry",
      "5",
      "--retry-all-errors",
      "--retry-delay",
      "1",
      "-A",
      "Mozilla/5.0 (compatible; JinLiu/1.0)",
      "--max-time",
      "120",
      url,
    ];
    let stdout = "";
    try {
      const res = await run("curl", args, { maxBuffer: 64 * 1024 * 1024 });
      stdout = String(res.stdout ?? "");
    } catch (err) {
      const e = err as { stdout?: string | Buffer };
      stdout = String(e.stdout ?? "");
      if (!stdout.trim()) return null;
    }
    if (!stdout.trim()) return null;
    return JSON.parse(stdout) as T;
  } catch {
    return null;
  }
}

type TwseTable = {
  stat?: string;
  tables?: { title?: string; fields?: string[]; data?: string[][] }[];
};

type TpexDailyQuotes = {
  tables?: { title?: string; fields?: string[]; data?: string[][] }[];
};

function parseTwseQuoteTable(fields: string[], data: string[][]): QuoteRow[] {
  const iCode = fields.findIndex((f) => f.includes("證券代號"));
  const iName = fields.findIndex((f) => f.includes("證券名稱"));
  const iOpen = fields.findIndex((f) => f === "開盤價");
  const iHigh = fields.findIndex((f) => f === "最高價");
  const iLow = fields.findIndex((f) => f === "最低價");
  const iTurnover = fields.findIndex((f) => f.includes("成交金額"));
  const iClose = fields.findIndex((f) => f === "收盤價");
  const iSign = fields.findIndex((f) => f.includes("漲跌(+/-)"));
  const iDiff = fields.findIndex((f) => f.includes("漲跌價差"));

  const quotes: QuoteRow[] = [];
  for (const row of data) {
    const code = String(row[iCode] ?? "").trim();
    if (!/^\d{4}/.test(code)) continue;
    const close = parseNumber(row[iClose]);
    if (close <= 0) continue;
    const signHtml = String(row[iSign] ?? "");
    const sign =
      signHtml.includes("red") || signHtml.includes("+")
        ? 1
        : signHtml.includes("green") || signHtml.includes("-")
          ? -1
          : 0;
    const diff = parseNumber(row[iDiff]) * sign;
    const prev = close - diff;
    const open = iOpen >= 0 ? parseNumber(row[iOpen]) : close;
    const high = iHigh >= 0 ? parseNumber(row[iHigh]) : Math.max(open, close);
    const low = iLow >= 0 ? parseNumber(row[iLow]) : Math.min(open, close);
    quotes.push({
      code,
      name: String(row[iName] ?? "").trim(),
      open: open > 0 ? open : close,
      high: high > 0 ? high : close,
      low: low > 0 ? low : close,
      close,
      changePct: prev > 0 ? (diff / prev) * 100 : 0,
      turnover: iTurnover >= 0 ? parseNumber(row[iTurnover]) : 0,
    });
  }
  return quotes;
}

export async function fetchTwseQuotes(ymd: string): Promise<{
  quotes: QuoteRow[];
  indexChangePct: number | null;
} | null> {
  const url = `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${ymd}&type=ALLBUT0999&response=json`;
  const payload = await fetchJson<TwseTable>(url);
  if (!payload || payload.stat !== "OK" || !payload.tables?.length) return null;

  let indexChangePct: number | null = null;
  for (const row of payload.tables[0]?.data ?? []) {
    if (String(row[0]).includes("發行量加權股價指數")) {
      indexChangePct = parseNumber(row[4]);
      break;
    }
  }

  const quoteTable = payload.tables.find((t) =>
    (t.title ?? "").includes("每日收盤行情"),
  );
  if (!quoteTable?.data?.length) return { quotes: [], indexChangePct };

  return {
    quotes: parseTwseQuoteTable(quoteTable.fields ?? [], quoteTable.data),
    indexChangePct,
  };
}

export async function fetchTpexQuotes(ymd: string): Promise<{
  quotes: QuoteRow[];
} | null> {
  const url = `https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=${toSlashDate(ymd)}&id=&response=json`;

  for (let attempt = 0; attempt < 3; attempt++) {
    const payload =
      (await fetchJsonViaCurl<TpexDailyQuotes>(url)) ??
      (await fetchJson<TpexDailyQuotes>(url));
    const table = payload?.tables?.[0];
    if (!table?.data?.length) {
      await sleep(400 * (attempt + 1));
      continue;
    }

    const fields = (table.fields ?? []).map((f) =>
      f.replace(/<[^>]+>/g, "").trim(),
    );
    const iCode = fields.findIndex((f) => f.includes("代號"));
    const iName = fields.findIndex((f) => f.includes("名稱"));
    const iOpen = fields.findIndex((f) => f.includes("開盤"));
    const iHigh = fields.findIndex((f) => f.includes("最高"));
    const iLow = fields.findIndex((f) => f.includes("最低"));
    const iClose = fields.findIndex((f) => f.includes("收盤"));
    const iChange = fields.findIndex(
      (f) => f.includes("漲跌") && !f.includes("%") && !f.includes("幅"),
    );
    const iAmt = fields.findIndex((f) => f.includes("成交金額"));

    const quotes: QuoteRow[] = [];
    for (const row of table.data) {
      const code = String(row[Math.max(iCode, 0)] ?? "").trim();
      // 只要普通股／KY（四碼，可選英文字尾）；排除權證與過長代號
      if (!/^\d{4}[A-Za-z]{0,2}$/.test(code)) continue;
      const close = parseNumber(row[iClose]);
      if (close <= 0) continue;
      const change = iChange >= 0 ? parseNumber(row[iChange]) : 0;
      const prev = close - change;
      const open = iOpen >= 0 ? parseNumber(row[iOpen]) : close;
      const high = iHigh >= 0 ? parseNumber(row[iHigh]) : Math.max(open, close);
      const low = iLow >= 0 ? parseNumber(row[iLow]) : Math.min(open, close);
      quotes.push({
        code,
        name: String(row[Math.max(iName, 1)] ?? "").trim(),
        open: open > 0 ? open : close,
        high: high > 0 ? high : close,
        low: low > 0 ? low : close,
        close,
        changePct: prev > 0 ? (change / prev) * 100 : 0,
        turnover: iAmt >= 0 ? parseNumber(row[iAmt]) : 0,
      });
    }
    // 上櫃普通股通常數百檔以上；太少代表 JSON 被截斷或解析失敗
    if (quotes.length >= 400) return { quotes };
    await sleep(500 * (attempt + 1));
  }
  return null;
}

export async function fetchTwseT86(ymd: string): Promise<InstiRow[] | null> {
  const url = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${ymd}&selectType=ALL&response=json`;
  const payload = await fetchJson<{
    stat?: string;
    fields?: string[];
    data?: string[][];
  }>(url);
  if (!payload || payload.stat !== "OK" || !payload.data?.length) return null;

  const fields = payload.fields ?? [];
  const idx = (pred: (f: string) => boolean) => fields.findIndex(pred);
  const iCode = idx((f) => f.includes("證券代號"));
  const iName = idx((f) => f.includes("證券名稱"));
  const iForeign = idx((f) => f.includes("外陸資買賣超股數(不含"));
  const iForeignDealer = idx((f) => f.includes("外資自營商買賣超"));
  const iTrust = idx((f) => f === "投信買賣超股數");
  const iDealer = idx((f) => f === "自營商買賣超股數");
  const iTotal = idx((f) => f.includes("三大法人買賣超"));

  return payload.data
    .map((row) => {
      const foreign =
        parseNumber(row[iForeign]) +
        (iForeignDealer >= 0 ? parseNumber(row[iForeignDealer]) : 0);
      const trust = iTrust >= 0 ? parseNumber(row[iTrust]) : 0;
      const dealer = iDealer >= 0 ? parseNumber(row[iDealer]) : 0;
      const total =
        iTotal >= 0 ? parseNumber(row[iTotal]) : foreign + trust + dealer;
      return {
        code: String(row[Math.max(iCode, 0)] ?? "").trim(),
        name: String(row[Math.max(iName, 1)] ?? "").trim(),
        foreign,
        trust,
        dealer,
        total,
      };
    })
    .filter((r) => /^\d{4}/.test(r.code));
}

export async function fetchTpexInsti(ymd: string): Promise<InstiRow[] | null> {
  const modernUrl = `https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade?date=${toSlashDate(ymd)}&type=Daily&cate=All&search=&response=json`;
  const legacyUrl = `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&o=json&se=EW&t=D&d=${encodeURIComponent(toRocSlash(ymd))}&s=0,asc`;

  type TpexInsti = {
    tables?: { fields?: string[]; data?: string[][] }[];
  };

  const payload =
    (await fetchJsonViaCurl<TpexInsti>(modernUrl)) ??
    (await fetchJson<TpexInsti>(modernUrl)) ??
    (await fetchJsonViaCurl<TpexInsti>(legacyUrl)) ??
    (await fetchJson<TpexInsti>(legacyUrl));

  const table = payload?.tables?.[0];
  if (!table?.data?.length) return null;

  return table.data
    .map((row) => ({
      code: String(row[0] ?? "").trim(),
      name: String(row[1] ?? "").trim(),
      foreign: parseNumber(row[10]),
      trust: parseNumber(row[13]),
      dealer: parseNumber(row[22]),
      total: parseNumber(row[23]),
    }))
    .filter((r) => /^\d{4}/.test(r.code));
}

/**
 * 快照目錄（與程式發佈分離）。
 * - 本機預設：`<cwd>/.cache`
 * - 正式環境請設 `CACHE_DIR` 指向持久磁碟（如 `/data/cache`），
 *   重發佈後歷史日檔仍在，日終同步只需補缺日／當日。
 */
function resolveCacheDir() {
  const fromEnv = process.env.CACHE_DIR?.trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv)
      ? fromEnv
      : path.resolve(process.cwd(), fromEnv);
  }
  return path.join(process.cwd(), ".cache");
}

const CACHE_DIR = resolveCacheDir();

/** 目前實際使用的快取根目錄（除錯／開機 log 用） */
export function getCacheDir() {
  return CACHE_DIR;
}

export const ACTIVE_FLOW_CACHE = "flow-active.json";
export const STAGING_FLOW_CACHE = "flow-staging.json";
/** 上個交易日收盤定稿（18:00 灰度切換前的保底） */
export const LAST_CLOSE_FLOW_CACHE = "flow-last-close.json";
export const DEPLOY_META_CACHE = "deploy-meta.json";

export type DeployMeta = {
  syncing: boolean;
  lastPromoteAt: string | null;
  lastBuildAt: string | null;
  lastError: string | null;
  activeBuiltAt: string | null;
  stagingBuiltAt: string | null;
};

export async function readCacheFile<T>(name: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path.join(CACHE_DIR, name), "utf8")) as T;
  } catch {
    return null;
  }
}

/** 原子寫入：先寫 tmp 再 rename，避免半成品被讀到 */
export async function writeCacheFile(name: string, data: unknown) {
  await mkdir(CACHE_DIR, { recursive: true });
  const target = path.join(CACHE_DIR, name);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(data), "utf8");
  await rename(tmp, target);
}

export async function readDeployMeta(): Promise<DeployMeta> {
  const meta = await readCacheFile<DeployMeta>(DEPLOY_META_CACHE);
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

export async function writeDeployMeta(patch: Partial<DeployMeta>) {
  const prev = await readDeployMeta();
  await writeCacheFile(DEPLOY_META_CACHE, { ...prev, ...patch });
}

export async function promoteStagingToActive() {
  const staging = await readCacheFile<unknown>(STAGING_FLOW_CACHE);
  if (!staging) throw new Error("staging 快取不存在，無法切換");
  await writeCacheFile(ACTIVE_FLOW_CACHE, staging);
  await writeDeployMeta({
    lastPromoteAt: new Date().toISOString(),
    activeBuiltAt: new Date().toISOString(),
    syncing: false,
    lastError: null,
  });
}

type DayQuoteCache = {
  ymd: string;
  quotes: QuoteRow[];
  indexChangePct: number | null;
  fetchedAt: string;
};

type DayInstiCache = {
  ymd: string;
  rows: InstiRow[];
  fetchedAt: string;
};

function dayCacheName(ymd: string) {
  return `quotes-${ymd}.json`;
}

function instiCacheName(ymd: string) {
  return `insti-${ymd}.json`;
}

/** 正規化產業 id，避免中文 id 出現編碼／未編碼兩套檔名 */
export function normalizeSectorId(sectorId: string): string {
  try {
    return decodeURIComponent(sectorId);
  } catch {
    return sectorId;
  }
}

export function klineCacheName(sectorId: string) {
  return `kline-${normalizeSectorId(sectorId)}.json`;
}

/** 相容舊版 encodeURIComponent 檔名 */
export function klineCacheNameCandidates(sectorId: string): string[] {
  const id = normalizeSectorId(sectorId);
  const names = [`kline-${id}.json`];
  const enc = encodeURIComponent(id);
  if (enc !== id) names.push(`kline-${enc}.json`);
  return names;
}

/** 快取是否已涵蓋足夠上櫃股（否則聯亞等 OTC 會變成成交 0） */
function looksLikeTwseOnly(quotes: QuoteRow[]): boolean {
  if (quotes.length >= 1800) return false;
  // 幾個常見上櫃指標股：缺一堆就當「櫃買沒併進去」
  const otcMarkers = ["3081", "4979", "6488", "3529", "8299"];
  const hit = otcMarkers.filter((c) => quotes.some((q) => q.code === c)).length;
  return hit < 2;
}

/** 合併上市＋上櫃當日報價並快取 */
export async function loadMergedQuotesDay(
  ymd: string,
  options?: { force?: boolean },
): Promise<DayQuoteCache | null> {
  const name = dayCacheName(ymd);
  if (!options?.force) {
    const cached = await readCacheFile<DayQuoteCache>(name);
    if (cached?.quotes?.length && !looksLikeTwseOnly(cached.quotes)) {
      return cached;
    }
    // 舊快取只有上市 → 下面補抓櫃買後覆寫
    if (cached?.quotes?.length) {
      const quotes = new Map(cached.quotes.map((q) => [q.code, q]));
      const tpex = await fetchTpexQuotes(ymd);
      if (tpex?.quotes.length) {
        for (const q of tpex.quotes) {
          if (!quotes.has(q.code)) quotes.set(q.code, q);
        }
        const bundle: DayQuoteCache = {
          ...cached,
          quotes: [...quotes.values()],
          fetchedAt: new Date().toISOString(),
        };
        await writeCacheFile(name, bundle);
        invalidateTradingDaysMemo();
        return bundle;
      }
      // 櫃買仍失敗就先用舊快取，避免整日空白
      return cached;
    }
  }

  const quotes = new Map<string, QuoteRow>();
  let indexChangePct: number | null = null;

  const twse = await fetchTwseQuotes(ymd);
  if (twse) {
    indexChangePct = twse.indexChangePct;
    for (const q of twse.quotes) quotes.set(q.code, q);
  }
  await sleep(180);
  const tpex = await fetchTpexQuotes(ymd);
  if (tpex) {
    for (const q of tpex.quotes) {
      if (!quotes.has(q.code)) quotes.set(q.code, q);
    }
  }

  if (quotes.size === 0) return null;

  const bundle: DayQuoteCache = {
    ymd,
    quotes: [...quotes.values()],
    indexChangePct,
    fetchedAt: new Date().toISOString(),
  };
  await writeCacheFile(name, bundle);
  invalidateTradingDaysMemo();
  return bundle;
}

/**
 * 產業 K／均線掃描目標交易日數。
 * 掃描只需 MA5／MA10，近約 60 個交易日即可（約一季），縮短同步時間。
 */
export const HISTORY_TRADING_DAYS = 60;
/** 對應 HISTORY_TRADING_DAYS 的日曆回看（含假日緩衝） */
export const HISTORY_CALENDAR_LOOKBACK = 130;

/** 交易日清單記憶體快取（避免每次開 K 線都掃上百個日檔） */
let tradingDaysMemo: { at: number; days: string[] } | null = null;
const TRADING_DAYS_MEMO_MS = 60_000;

/** 寫入新的 quotes 日檔後必須清掉，否則會一直回傳補價前的短清單 */
export function invalidateTradingDaysMemo() {
  tradingDaysMemo = null;
}

/**
 * 只掃本機 quotes 快取，不打證交所。
 * 優先 readdir 一次列出 quotes-*.json，避免逐日探測磁碟。
 */
export async function listCachedTradingDays(
  need: number,
  lookbackCalendar = HISTORY_CALENDAR_LOOKBACK,
): Promise<string[]> {
  const now = Date.now();
  // 記憶體命中必須「根數夠」：否則 ensureQuoteHistory 補完日檔後仍讀到舊的 16 根
  if (
    tradingDaysMemo &&
    now - tradingDaysMemo.at < TRADING_DAYS_MEMO_MS &&
    tradingDaysMemo.days.length >= need
  ) {
    return tradingDaysMemo.days.slice(0, need);
  }

  try {
    const files = await readdir(CACHE_DIR);
    const days = files
      .map((f) => /^quotes-(\d{8})\.json$/.exec(f)?.[1])
      .filter((ymd): ymd is string => Boolean(ymd))
      .sort((a, b) => b.localeCompare(a));
    if (days.length) {
      tradingDaysMemo = { at: now, days };
      return days.slice(0, need);
    }
  } catch {
    /* fall through to calendar probe */
  }

  const days: string[] = [];
  const cursor = new Date();
  cursor.setHours(12, 0, 0, 0);

  for (let i = 0; i < lookbackCalendar && days.length < need; i++) {
    const ymd = toYmd(cursor);
    const cached = await readCacheFile<DayQuoteCache>(dayCacheName(ymd));
    if (cached?.quotes?.length) days.push(ymd);
    cursor.setDate(cursor.getDate() - 1);
  }
  tradingDaysMemo = { at: now, days };
  return days.slice(0, need);
}

/** 最新有 quotes 快取的交易日（記憶體命中極快） */
export async function getLatestCachedTradingDay(): Promise<string | null> {
  const days = await listCachedTradingDays(1, 40);
  return days[0] ?? null;
}

/**
 * 向後抓取足夠的交易日報價（上市＋上櫃合併），寫入 CACHE_DIR。
 * 已有日檔會直接沿用，只補缺日——持久碟上歷史不必每天重抓。
 * 正式環境若只有十來根 K，多半是快取被重發佈清掉或深度不夠。
 */
export async function listRecentTradingDays(
  need: number,
  lookbackCalendar = HISTORY_CALENDAR_LOOKBACK,
  options?: {
    cacheOnly?: boolean;
    onProgress?: (done: number, need: number) => void;
  },
): Promise<string[]> {
  if (options?.cacheOnly) return listCachedTradingDays(need, lookbackCalendar);

  const days: string[] = [];
  const cursor = new Date();
  cursor.setHours(12, 0, 0, 0);
  let wrote = false;

  for (let i = 0; i < lookbackCalendar && days.length < need; i++) {
    const ymd = toYmd(cursor);
    const dow = cursor.getDay();
    // 週六日不打網路，減少無謂等待
    if (dow === 0 || dow === 6) {
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }

    const cached = await readCacheFile<DayQuoteCache>(dayCacheName(ymd));
    if (cached?.quotes?.length) {
      // 已有日檔就計入深度（即使舊檔偏上市）；缺日才打交易所
      days.push(ymd);
      options?.onProgress?.(days.length, need);
    } else {
      const bundle = await loadMergedQuotesDay(ymd);
      if (bundle?.quotes?.length) {
        days.push(ymd);
        wrote = true;
      }
      await sleep(220);
    }
    options?.onProgress?.(days.length, need);
    cursor.setDate(cursor.getDate() - 1);
  }

  if (wrote) invalidateTradingDaysMemo();
  return days;
}

const dayQuotesMemo = new Map<string, Map<string, QuoteRow>>();

export async function getCachedDayQuotes(
  ymd: string,
): Promise<Map<string, QuoteRow> | null> {
  const hit = dayQuotesMemo.get(ymd);
  if (hit) return hit;
  const cached = await readCacheFile<DayQuoteCache>(dayCacheName(ymd));
  if (!cached?.quotes?.length) return null;
  const map = new Map(cached.quotes.map((q) => [q.code, q]));
  // 僅保留最近 ~100 日，避免長駐記憶體無限長
  if (dayQuotesMemo.size > 120) {
    const first = dayQuotesMemo.keys().next().value;
    if (first) dayQuotesMemo.delete(first);
  }
  dayQuotesMemo.set(ymd, map);
  return map;
}

/** 合併上市 T86 + 櫃買法人日報並快取 */
export async function loadMergedInstiDay(
  ymd: string,
  options?: { force?: boolean; watchCodes?: Set<string> },
): Promise<Map<string, InstiRow> | null> {
  const name = instiCacheName(ymd);
  if (!options?.force) {
    const cached = await readCacheFile<DayInstiCache>(name);
    if (cached?.rows?.length) {
      return new Map(cached.rows.map((r) => [r.code, r]));
    }
  }

  const byCode = new Map<string, InstiRow>();
  const twse = await fetchTwseT86(ymd);
  if (twse) {
    for (const row of twse) {
      if (options?.watchCodes && !options.watchCodes.has(row.code)) continue;
      byCode.set(row.code, row);
    }
  }
  await sleep(180);
  const tpex = await fetchTpexInsti(ymd);
  if (tpex) {
    for (const row of tpex) {
      if (options?.watchCodes && !options.watchCodes.has(row.code)) continue;
      if (!byCode.has(row.code)) byCode.set(row.code, row);
    }
  }

  if (byCode.size === 0) return null;

  const bundle: DayInstiCache = {
    ymd,
    rows: [...byCode.values()],
    fetchedAt: new Date().toISOString(),
  };
  await writeCacheFile(name, bundle);
  return byCode;
}

export async function getCachedDayInsti(
  ymd: string,
): Promise<Map<string, InstiRow> | null> {
  const cached = await readCacheFile<DayInstiCache>(instiCacheName(ymd));
  if (!cached?.rows?.length) return null;
  return new Map(cached.rows.map((r) => [r.code, r]));
}
