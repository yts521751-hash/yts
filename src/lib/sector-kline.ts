import type { SectorCandle } from "@/lib/types";
import type { SectorDef } from "@/lib/sector-universe";
import { lookupSectorDef } from "@/lib/resolve-universe";
import {
  blendFlow,
  instiSharesToYi,
  signedFlowFromQuote,
} from "@/lib/money-flow";
import {
  getCachedDayInsti,
  getCachedDayQuotes,
  getLatestCachedTradingDay,
  HISTORY_CALENDAR_LOOKBACK,
  HISTORY_TRADING_DAYS,
  klineCacheName,
  klineCacheNameCandidates,
  listCachedTradingDays,
  normalizeSectorId,
  readCacheFile,
  writeCacheFile,
  ymdToIso,
  type InstiRow,
  type QuoteRow,
} from "@/lib/tw-market";

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;

const FORMULA = "blend-80-20" as const;

export type SectorKlinePayload = {
  sectorId: string;
  sectorName: string;
  candles: SectorCandle[];
  base: number;
  quoteDays: string[];
  builtAt: string;
  formula: typeof FORMULA;
  source: "cache" | "live" | "memory";
};

const MEM_TTL_MS = 5 * 60 * 1000;
const REBUILD_CONCURRENCY = 12;

type MemEntry = { at: number; data: SectorKlinePayload };
const memKline = new Map<string, MemEntry>();

function memGet(sectorId: string): SectorKlinePayload | null {
  const key = normalizeSectorId(sectorId);
  const hit = memKline.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > MEM_TTL_MS) {
    memKline.delete(key);
    return null;
  }
  return { ...hit.data, source: "memory" };
}

function memSet(data: SectorKlinePayload) {
  const key = normalizeSectorId(data.sectorId);
  if (memKline.size > 80) {
    const first = memKline.keys().next().value;
    if (first) memKline.delete(first);
  }
  memKline.set(key, { at: Date.now(), data });
}

async function readDiskKline(
  sectorId: string,
): Promise<SectorKlinePayload | null> {
  for (const name of klineCacheNameCandidates(sectorId)) {
    const cached = await readCacheFile<SectorKlinePayload>(name);
    if (cached?.candles?.length && cached.formula === FORMULA) {
      return cached;
    }
  }
  return null;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(1, items.length)) },
    async () => {
      while (cursor < items.length) {
        const idx = cursor++;
        out[idx] = await fn(items[idx], idx);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

/** 只讀快取（記憶體→磁碟），不重建。SSR 首屏用此避免 TTFB 被拖慢。 */
export async function readSectorKlineCache(
  sectorId: string,
): Promise<SectorKlinePayload | null> {
  const mem = memGet(sectorId);
  if (mem?.candles?.length) return mem;
  const disk = await readDiskKline(sectorId);
  if (!disk?.candles?.length) return null;
  memSet(disk);
  return { ...disk, source: "cache" };
}


/**
 * 產業合成 K 線（類三竹族群圖）：
 * 以成分股當日成交金額為權重，把個股相對前收的開高低收報酬
 * 加權合成後，串成指數型 OHLC（基準 100）。
 *
 * 流入／流出採 80% 成交×漲跌 + 20% 法人買賣超（有法人快取時）。
 * 請求路徑只讀本機 quotes／insti 快取，不打證交所。
 */
export async function buildSectorKline(
  sectorId: string,
  days = HISTORY_TRADING_DAYS,
  options?: { force?: boolean; def?: SectorDef },
): Promise<SectorKlinePayload | null> {
  const id = normalizeSectorId(sectorId);
  const def = options?.def ?? (await lookupSectorDef(id));
  if (!def) return null;

  // 快取優先：先讀記憶體／磁碟，避免每次都掃交易日清單
  // 日線根數不足時不可當「夠用」（舊的極短快取不可卡住掃描）
  const minBars =
    days >= 40 ? Math.min(days, Math.max(20, days - 5)) : Math.min(days, 10);
  if (!options?.force) {
    const mem = memGet(id);
    if (mem?.candles?.length && mem.candles.length >= minBars) {
      const latest = await getLatestCachedTradingDay();
      if (!latest || mem.quoteDays?.[0] === latest) return mem;
    }
    const disk = await readDiskKline(id);
    if (disk?.candles?.length && disk.candles.length >= minBars) {
      const latest = await getLatestCachedTradingDay();
      const freshEnough =
        !latest ||
        disk.quoteDays?.[0] === latest ||
        (disk.quoteDays?.length ?? 0) >= minBars - 2;
      if (freshEnough) {
        memSet(disk);
        return { ...disk, source: "cache" };
      }
    }
  }

  // 缺快取時先補報價再掃（深度依 HISTORY_TRADING_DAYS，約 60 日）
  try {
    const { ensureQuoteHistory } = await import("@/lib/turnover");
    await ensureQuoteHistory(Math.max(days, HISTORY_TRADING_DAYS));
  } catch {
    /* 補價失敗仍嘗試用現有快取 */
  }
  const tradingDays = await listCachedTradingDays(
    days,
    HISTORY_CALENDAR_LOOKBACK,
  );
  if (tradingDays.length < 5) return null;

  const chronological = [...tradingDays].reverse();
  const loaded = await mapPool(
    chronological,
    REBUILD_CONCURRENCY,
    async (ymd) => {
      const map = await getCachedDayQuotes(ymd);
      if (!map || map.size === 0) return null;
      const insti =
        (await getCachedDayInsti(ymd)) ?? new Map<string, InstiRow>();
      return { ymd, map, insti };
    },
  );
  const series = loaded.filter(
    (
      x,
    ): x is {
      ymd: string;
      map: Map<string, QuoteRow>;
      insti: Map<string, InstiRow>;
    } => Boolean(x),
  );

  if (series.length < 5) return null;

  const BASE = 100;
  let indexClose = BASE;
  const candles: SectorCandle[] = [];

  for (const { ymd, map, insti } of series) {
    const members: {
      w: number;
      openRet: number;
      highRet: number;
      lowRet: number;
      closeRet: number;
      flow: ReturnType<typeof blendFlow>;
    }[] = [];

    for (const m of def.members) {
      const q = map.get(m.code);
      if (!q || q.close <= 0 || q.turnover <= 0) continue;

      const prev =
        Math.abs(q.changePct) < 50 && q.changePct !== 0
          ? q.close / (1 + q.changePct / 100)
          : q.close;
      if (prev <= 0) continue;

      const price = signedFlowFromQuote(q.turnover, q.changePct);
      const row = insti.get(m.code);
      const instiYi =
        row && q.close > 0 ? instiSharesToYi(row.total, q.close) : null;

      members.push({
        w: q.turnover,
        openRet: (q.open - prev) / prev,
        highRet: (q.high - prev) / prev,
        lowRet: (q.low - prev) / prev,
        closeRet: (q.close - prev) / prev,
        flow: blendFlow(price, instiYi),
      });
    }

    if (!members.length) continue;
    const tw = members.reduce((s, x) => s + x.w, 0);
    if (tw <= 0) continue;

    const wavg = (pick: (m: (typeof members)[0]) => number) =>
      members.reduce((s, m) => s + (m.w / tw) * pick(m), 0);

    const openRet = wavg((m) => m.openRet);
    const highRet = wavg((m) => m.highRet);
    const lowRet = wavg((m) => m.lowRet);
    const closeRet = wavg((m) => m.closeRet);

    const prevIndex = indexClose;
    const open = prevIndex * (1 + openRet);
    let high = prevIndex * (1 + highRet);
    let low = prevIndex * (1 + lowRet);
    const close = prevIndex * (1 + closeRet);
    high = Math.max(high, open, close);
    low = Math.min(low, open, close);

    const amount = members.reduce((s, m) => s + m.flow.amt, 0);
    const inflow = members.reduce((s, m) => s + m.flow.inflow, 0);
    const outflow = members.reduce((s, m) => s + m.flow.outflow, 0);

    candles.push({
      date: ymdToIso(ymd),
      open: round2(open),
      high: round2(high),
      low: round2(low),
      close: round2(close),
      amount: round1(amount),
      flow: round1(inflow - outflow),
      inflow: round1(inflow),
      outflow: round1(outflow),
      changePct: round2(closeRet * 100),
    });

    indexClose = close;
  }

  if (candles.length < 5) return null;

  const payload: SectorKlinePayload = {
    sectorId: def.id,
    sectorName: def.name,
    candles,
    base: BASE,
    quoteDays: tradingDays,
    builtAt: new Date().toISOString(),
    formula: FORMULA,
    source: "live",
  };
  await writeCacheFile(klineCacheName(def.id), payload);
  memSet(payload);
  return payload;
}

export async function warmSectorKlineCaches(
  days = HISTORY_TRADING_DAYS,
  defs?: SectorDef[],
  options?: { onProgress?: (done: number, total: number) => void },
) {
  const list = defs?.length ? defs : [];
  let done = 0;
  const total = list.length;
  await mapPool(list, 4, async (def) => {
    try {
      await buildSectorKline(def.id, days, { force: true, def });
    } catch (err) {
      console.warn(`[kline] warm ${def.id} failed:`, err);
    } finally {
      done += 1;
      options?.onProgress?.(done, total);
    }
  });
}
