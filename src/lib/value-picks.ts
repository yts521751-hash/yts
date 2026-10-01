/**
 * 價值選股：明年 EPS YoY（法人中位數）> 50%，前瞻本益比 < 35，
 * 且當日一般成交金額 ≥ 10 億。
 */

import { enrichStockFundamentals } from "@/lib/fundamentals";
import { applyRegularTurnover } from "@/lib/regular-turnover";
import { isCommonStock } from "@/lib/stock-filter";
import { loadIndustryMap } from "@/lib/industry-map";
import {
  getCachedDayQuotes,
  listCachedTradingDays,
  readCacheFile,
  writeCacheFile,
  ymdToIso,
} from "@/lib/tw-market";

export type ValuePickRow = {
  rank: number;
  code: string;
  name: string;
  /** 美股：英文全名 */
  nameEn?: string;
  /** 美股：中文短名 */
  nameZh?: string;
  close: number;
  changePct: number;
  /** 當日一般成交（億） */
  dayAmt: number;
  /** 明年 EPS（法人中位數） */
  nextYearEps: number;
  /** 今年／基準 EPS（法人中位數） */
  baseEps: number;
  /** 明年 EPS YoY % */
  epsYoy: number;
  /** 前瞻本益比 = close / nextYearEps */
  forwardPe: number;
  epsSource: string | null;
  /** 明年 EPS 依據列（券商或共識統計） */
  brokers?: import("@/lib/fundamentals").BrokerEpsEstimate[];
  consensusBasis?: import("@/lib/fundamentals").EpsConsensusBasis | null;
};

/** 單股查詢結果（不一定通過價值篩選） */
export type StockValueLookup = {
  code: string;
  name: string;
  close: number;
  changePct: number;
  dayAmt: number;
  nextYearEps: number | null;
  baseEps: number | null;
  epsYoy: number | null;
  forwardPe: number | null;
  epsSource: string | null;
  revenueYoy: number | null;
  revenueMonth: string | null;
  brokers: import("@/lib/fundamentals").BrokerEpsEstimate[];
  consensusBasis: import("@/lib/fundamentals").EpsConsensusBasis | null;
  passesScreen: boolean;
  ymd: string;
  date: string;
};

export type ValuePicksPayload = {
  date: string;
  ymd: string;
  rows: ValuePickRow[];
  builtAt: string;
  source: "cache" | "rebuilt";
  /** 掃描候選檔數 */
  scanned: number;
  /** 篩選條件說明 */
  criteria: {
    minEpsYoy: number;
    maxForwardPe: number;
    minDayAmtYi: number;
  };
};

const CACHE = "value-picks-latest.json";
const MIN_EPS_YOY = 50;
const MAX_FORWARD_PE = 35;
const MIN_DAY_AMT_YI = 10;
/** 取成交較熱的普通股當候選，兼顧涵蓋與抓取時間 */
const CANDIDATE_LIMIT = 300;

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

export async function readValuePicksCache(): Promise<ValuePicksPayload | null> {
  return readCacheFile<ValuePicksPayload>(CACHE);
}

function valueBag() {
  const g = globalThis as typeof globalThis & {
    __jinliuValuePicks?: {
      rebuilding: boolean;
      promise: Promise<ValuePicksPayload | null> | null;
    };
  };
  if (!g.__jinliuValuePicks) {
    g.__jinliuValuePicks = { rebuilding: false, promise: null };
  }
  return g.__jinliuValuePicks;
}

function buildValuePicksSingleFlight(options?: {
  force?: boolean;
}): Promise<ValuePicksPayload | null> {
  const bag = valueBag();
  if (bag.promise) return bag.promise;
  bag.rebuilding = true;
  bag.promise = buildValuePicks(options)
    .catch((err) => {
      console.error("[value-picks] rebuild failed", err);
      return null;
    })
    .finally(() => {
      bag.rebuilding = false;
      bag.promise = null;
    });
  return bag.promise;
}

/** 背景重建價值選股；不阻塞 HTTP */
export function requestValuePicksRebuild(reason: string): {
  started: boolean;
  alreadyRunning: boolean;
} {
  const bag = valueBag();
  if (bag.rebuilding || bag.promise) {
    return { started: false, alreadyRunning: true };
  }
  console.log(`[value-picks] background rebuild (${reason})`);
  void buildValuePicksSingleFlight({
    force: reason === "api-force" || reason === "daily-close",
  }).then((p) => {
    console.log(
      `[value-picks] background rebuild ${p?.rows != null ? "ok" : "empty"} (${reason})`,
    );
  });
  return { started: true, alreadyRunning: false };
}

/** 前景／背景共用的單飛重建 */
export function getValuePicksSingleFlight(options?: {
  force?: boolean;
}): Promise<ValuePicksPayload | null> {
  return buildValuePicksSingleFlight(options);
}

export async function buildValuePicks(options?: {
  force?: boolean;
}): Promise<ValuePicksPayload | null> {
  if (!options?.force) {
    const cached = await readValuePicksCache();
    if (cached?.rows && cached.builtAt) {
      const age = Date.now() - Date.parse(cached.builtAt);
      // 舊快照若沒有成交門檻，視為失效
      if (
        Number.isFinite(age) &&
        age >= 0 &&
        age < 20 * 60 * 60 * 1000 &&
        cached.criteria?.minDayAmtYi === MIN_DAY_AMT_YI
      ) {
        return { ...cached, source: "cache" };
      }
    }
  }

  const days = await listCachedTradingDays(1, 40);
  const ymd = days[0];
  if (!ymd) return null;
  const quotes = await getCachedDayQuotes(ymd);
  if (!quotes?.size) return null;

  const regular = await applyRegularTurnover(quotes, ymd, {
    force: Boolean(options?.force),
  });

  const candidates = [...quotes.values()]
    .filter((q) => isCommonStock(q.code, q.name) && q.close > 0)
    .map((q) => ({
      q,
      dayAmtYi: (regular.get(q.code) ?? q.turnover) / 1e8,
    }))
    .filter((x) => x.dayAmtYi >= MIN_DAY_AMT_YI)
    .sort((a, b) => b.dayAmtYi - a.dayAmtYi)
    .slice(0, CANDIDATE_LIMIT);

  const fund = await enrichStockFundamentals(
    candidates.map((x) => x.q.code),
    { force: Boolean(options?.force) },
  );

  const rows: Omit<ValuePickRow, "rank">[] = [];
  for (const { q, dayAmtYi } of candidates) {
    const f = fund.get(q.code);
    if (!f) continue;
    const nextYearEps = f.nextYearEps;
    const baseEps = f.baseEps;
    const epsYoy = f.epsGrowth;
    if (
      nextYearEps == null ||
      nextYearEps <= 0 ||
      baseEps == null ||
      baseEps <= 0 ||
      epsYoy == null
    ) {
      continue;
    }
    if (epsYoy <= MIN_EPS_YOY) continue;
    const forwardPe = q.close / nextYearEps;
    if (
      !Number.isFinite(forwardPe) ||
      forwardPe <= 0 ||
      forwardPe >= MAX_FORWARD_PE
    ) {
      continue;
    }
    if (!f.epsSource?.startsWith("cnyes-factset-")) continue;

    rows.push({
      code: q.code,
      name: q.name.trim() || q.code,
      close: round2(q.close),
      changePct: round2(q.changePct),
      // 與成值頁相同：先存兩位再由 UI 固定一位小數顯示
      dayAmt: round2(dayAmtYi),
      nextYearEps: round2(nextYearEps),
      baseEps: round2(baseEps),
      epsYoy: round1(epsYoy),
      forwardPe: round2(forwardPe),
      epsSource: f.epsSource,
      brokers: f.brokers ?? [],
      consensusBasis: f.consensusBasis ?? null,
    });
  }

  rows.sort(
    (a, b) =>
      b.epsYoy - a.epsYoy || a.forwardPe - b.forwardPe || b.dayAmt - a.dayAmt,
  );

  const payload: ValuePicksPayload = {
    date: ymdToIso(ymd),
    ymd,
    rows: rows.map((r, i) => ({ ...r, rank: i + 1 })),
    builtAt: new Date().toISOString(),
    source: "rebuilt",
    scanned: candidates.length,
    criteria: {
      minEpsYoy: MIN_EPS_YOY,
      maxForwardPe: MAX_FORWARD_PE,
      minDayAmtYi: MIN_DAY_AMT_YI,
    },
  };
  await writeCacheFile(CACHE, payload);
  return payload;
}

const LOOKUP_MEMO_TTL_MS = 5 * 60 * 1000;

function lookupMemoBag() {
  const g = globalThis as typeof globalThis & {
    __jinliuValueLookupMemo?: Map<
      string,
      { at: number; value: StockValueLookup | null }
    >;
  };
  if (!g.__jinliuValueLookupMemo) g.__jinliuValueLookupMemo = new Map();
  return g.__jinliuValueLookupMemo;
}

function normalizeLookupKey(query: string) {
  return query.trim().toLowerCase();
}

function lookupFromValueRow(
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

/**
 * 以代號或名稱查單股，回傳與價值選股相同口徑的指標＋明年 EPS 依據。
 * 快取優先、不阻塞券商目標價刮取（目標價由 /api/broker-targets 懶載）。
 */
export async function lookupStockValue(
  query: string,
): Promise<StockValueLookup | null> {
  const q = query.trim();
  if (!q) return null;

  const memoKey = normalizeLookupKey(q);
  const memo = lookupMemoBag();
  const hit = memo.get(memoKey);
  if (hit && Date.now() - hit.at < LOOKUP_MEMO_TTL_MS) {
    return hit.value;
  }

  // 快路徑：已在價值選股名單 → 直接組結果（含 PE／EPS）
  const vp = await readValuePicksCache().catch(() => null);
  if (vp?.rows?.length) {
    const needle = q.toLowerCase();
    const row =
      (/^\d{4}$/.test(q) && vp.rows.find((r) => r.code === q)) ||
      vp.rows.find(
        (r) =>
          r.name === q ||
          r.name.toLowerCase().includes(needle) ||
          needle.includes(r.name.toLowerCase()),
      ) ||
      null;
    if (row) {
      const value = lookupFromValueRow(row, vp.ymd, vp.date);
      memo.set(memoKey, { at: Date.now(), value });
      memo.set(normalizeLookupKey(row.code), { at: Date.now(), value });
      return value;
    }
  }

  const days = await listCachedTradingDays(1, 40);
  const ymd = days[0];
  if (!ymd) return null;
  const quotes = await getCachedDayQuotes(ymd);
  if (!quotes?.size) return null;

  let code: string | null = null;
  let name = "";

  if (/^\d{4}$/.test(q)) {
    const row = quotes.get(q);
    if (row) {
      code = q;
      name = row.name.trim() || q;
    }
  }

  if (!code) {
    const needle = q.toLowerCase();
    for (const row of quotes.values()) {
      if (!isCommonStock(row.code, row.name)) continue;
      if (row.name.trim() === q || row.name.toLowerCase().includes(needle)) {
        code = row.code;
        name = row.name.trim() || row.code;
        break;
      }
    }
  }

  if (!code) {
    const map = await loadIndustryMap().catch(() => null);
    if (map?.stocks?.length) {
      const needle = q.toLowerCase();
      const hitStock =
        map.stocks.find((s) => s.code === q) ||
        map.stocks.find(
          (s) =>
            s.name === q ||
            s.name.toLowerCase().includes(needle) ||
            needle.includes(s.name.toLowerCase()),
        );
      if (hitStock) {
        code = hitStock.code;
        name = hitStock.name;
      }
    }
  }

  if (!code) {
    memo.set(memoKey, { at: Date.now(), value: null });
    return null;
  }

  // 代號命中記憶體／名單快取
  const byCode = memo.get(normalizeLookupKey(code));
  if (byCode && Date.now() - byCode.at < LOOKUP_MEMO_TTL_MS) {
    memo.set(memoKey, { at: Date.now(), value: byCode.value });
    return byCode.value;
  }

  const quote = quotes.get(code);
  const close = quote?.close ?? 0;
  const changePct = quote?.changePct ?? 0;
  if (quote) name = quote.name.trim() || name || code;

  const [regular, fundMap] = await Promise.all([
    applyRegularTurnover(quotes, ymd, { skipNetwork: true }),
    enrichStockFundamentals([code], { force: false, preferStale: true }),
  ]);
  const dayAmt = round2((regular.get(code) ?? quote?.turnover ?? 0) / 1e8);

  const f = fundMap.get(code);
  const nextYearEps = f?.nextYearEps ?? null;
  const baseEps = f?.baseEps ?? null;
  const epsYoy = f?.epsGrowth ?? null;
  const forwardPe =
    nextYearEps != null && nextYearEps > 0 && close > 0
      ? round2(close / nextYearEps)
      : null;

  const passesScreen = Boolean(
    nextYearEps != null &&
      nextYearEps > 0 &&
      baseEps != null &&
      baseEps > 0 &&
      epsYoy != null &&
      epsYoy > MIN_EPS_YOY &&
      forwardPe != null &&
      forwardPe > 0 &&
      forwardPe < MAX_FORWARD_PE &&
      dayAmt >= MIN_DAY_AMT_YI &&
      f?.epsSource?.startsWith("cnyes-factset-"),
  );

  const value: StockValueLookup = {
    code,
    name: name || code,
    close: round2(close),
    changePct: round2(changePct),
    dayAmt,
    nextYearEps: nextYearEps != null ? round2(nextYearEps) : null,
    baseEps: baseEps != null ? round2(baseEps) : null,
    epsYoy: epsYoy != null ? round1(epsYoy) : null,
    forwardPe,
    epsSource: f?.epsSource ?? null,
    revenueYoy: f?.revenueYoy ?? null,
    revenueMonth: f?.revenueMonth ?? null,
    brokers: f?.brokers ?? [],
    consensusBasis: f?.consensusBasis ?? null,
    passesScreen,
    ymd,
    date: ymdToIso(ymd),
  };
  memo.set(memoKey, { at: Date.now(), value });
  memo.set(normalizeLookupKey(code), { at: Date.now(), value });
  if (memo.size > 200) {
    const first = memo.keys().next().value;
    if (first) memo.delete(first);
  }
  return value;
}
