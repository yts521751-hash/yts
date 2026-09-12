import type { SectorCandle } from "@/lib/types";
import { SECTOR_UNIVERSE } from "@/lib/sector-universe";
import {
  blendFlow,
  instiSharesToYi,
  signedFlowFromQuote,
} from "@/lib/money-flow";
import {
  getCachedDayInsti,
  getCachedDayQuotes,
  klineCacheName,
  listCachedTradingDays,
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
  source: "cache" | "live";
};

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
  days = 40,
  options?: { force?: boolean },
): Promise<SectorKlinePayload | null> {
  const def = SECTOR_UNIVERSE.find((s) => s.id === sectorId);
  if (!def) return null;

  const tradingDays = await listCachedTradingDays(days, 120);
  if (tradingDays.length < 5) return null;

  const cacheName = klineCacheName(sectorId);
  if (!options?.force) {
    const cached = await readCacheFile<SectorKlinePayload>(cacheName);
    if (
      cached?.candles?.length &&
      cached.formula === FORMULA &&
      cached.quoteDays?.[0] === tradingDays[0] &&
      cached.quoteDays?.length >= Math.min(days, tradingDays.length) - 2
    ) {
      return { ...cached, source: "cache" };
    }
  }

  const chronological = [...tradingDays].reverse();
  const series: {
    ymd: string;
    map: Map<string, QuoteRow>;
    insti: Map<string, InstiRow>;
  }[] = [];

  for (const ymd of chronological) {
    const map = await getCachedDayQuotes(ymd);
    if (!map || map.size === 0) continue;
    const insti = (await getCachedDayInsti(ymd)) ?? new Map<string, InstiRow>();
    series.push({ ymd, map, insti });
  }

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
  await writeCacheFile(cacheName, payload);
  return payload;
}

export async function warmSectorKlineCaches(days = 40) {
  for (const def of SECTOR_UNIVERSE) {
    try {
      await buildSectorKline(def.id, days, { force: true });
    } catch (err) {
      console.warn(`[kline] warm ${def.id} failed:`, err);
    }
  }
}
