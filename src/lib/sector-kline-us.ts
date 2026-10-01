/**
 * 美股產業合成 K 線：成分成交加權 OHLC + 金流柱（成交×漲跌＋rvol）。
 */

import type { SectorCandle } from "@/lib/types";
import type { SectorDef } from "@/lib/sector-universe";
import { blendUsFlow } from "@/lib/money-flow";
import { US_SECTOR_UNIVERSE, lookupUsSectorDef } from "@/lib/us-sector-universe";
import {
  US_HISTORY_TRADING_DAYS,
  computeRvolForCode,
  getUsCachedDayQuotes,
  listUsCachedTradingDays,
  readUsCacheFile,
  usKlineCacheName,
  writeUsCacheFile,
  ymdToIso,
  type UsQuoteRow,
} from "@/lib/us-market";

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;
const FORMULA = "us-blend-80-20-rvol" as const;

export type UsSectorKlinePayload = {
  sectorId: string;
  sectorName: string;
  candles: SectorCandle[];
  base: number;
  quoteDays: string[];
  builtAt: string;
  formula: typeof FORMULA;
  source: "cache" | "live" | "memory";
  market: "us";
  flowLabel: string;
};

const MEM_TTL_MS = 5 * 60 * 1000;
const memKline = new Map<string, { at: number; data: UsSectorKlinePayload }>();

function memGet(id: string) {
  const hit = memKline.get(id);
  if (!hit) return null;
  if (Date.now() - hit.at > MEM_TTL_MS) {
    memKline.delete(id);
    return null;
  }
  return { ...hit.data, source: "memory" as const };
}

function memSet(data: UsSectorKlinePayload) {
  if (memKline.size > 80) {
    const first = memKline.keys().next().value;
    if (first) memKline.delete(first);
  }
  memKline.set(data.sectorId, { at: Date.now(), data });
}

export async function readUsSectorKlineCache(
  sectorId: string,
): Promise<UsSectorKlinePayload | null> {
  const mem = memGet(sectorId);
  if (mem?.candles?.length) return mem;
  const disk = await readUsCacheFile<UsSectorKlinePayload>(
    usKlineCacheName(sectorId),
  );
  if (!disk?.candles?.length) return null;
  memSet(disk);
  return { ...disk, source: "cache", market: "us" };
}

export async function buildUsSectorKline(
  sectorId: string,
  options?: { days?: number; force?: boolean },
): Promise<UsSectorKlinePayload | null> {
  if (!options?.force) {
    const cached = await readUsSectorKlineCache(sectorId);
    if (cached?.candles?.length) return cached;
  }

  const def =
    lookupUsSectorDef(sectorId) ||
    US_SECTOR_UNIVERSE.find((s) => s.id === sectorId);
  if (!def) return null;

  const need = options?.days ?? US_HISTORY_TRADING_DAYS;
  const days = await listUsCachedTradingDays(need, 130);
  if (days.length < 10) return null;

  // days 新→舊；合成時改舊→新
  const chron = [...days].reverse();
  const quotesByDay = new Map<string, Map<string, UsQuoteRow>>();
  for (const ymd of days) {
    const q = await getUsCachedDayQuotes(ymd);
    if (q) quotesByDay.set(ymd, q);
  }

  const members = def.members.map((m) => m.code.toUpperCase());
  const candles: SectorCandle[] = [];
  let index = 100;

  for (let i = 0; i < chron.length; i++) {
    const ymd = chron[i];
    const dayQuotes = quotesByDay.get(ymd);
    if (!dayQuotes) continue;

    const newestFirst = [...chron].reverse();
    const dayIndexInNewest = newestFirst.indexOf(ymd);

    let wSum = 0;
    let retO = 0;
    let retH = 0;
    let retL = 0;
    let retC = 0;
    let amount = 0;
    let flow = 0;
    let inflow = 0;
    let outflow = 0;
    let chgSum = 0;
    let chgN = 0;

    for (const code of members) {
      const q = dayQuotes.get(code);
      if (!q || !(q.close > 0) || !(q.turnover > 0)) continue;
      const prevYmd = i > 0 ? chron[i - 1] : null;
      const prev = prevYmd ? quotesByDay.get(prevYmd)?.get(code) : null;
      const prevClose = prev?.close && prev.close > 0 ? prev.close : q.open || q.close;
      if (!(prevClose > 0)) continue;

      const w = q.turnover;
      wSum += w;
      amount += q.turnover / 1e8;
      retO += w * ((q.open - prevClose) / prevClose);
      retH += w * ((q.high - prevClose) / prevClose);
      retL += w * ((q.low - prevClose) / prevClose);
      retC += w * ((q.close - prevClose) / prevClose);
      chgSum += q.changePct;
      chgN++;

      const rvol =
        dayIndexInNewest >= 0
          ? computeRvolForCode(code, newestFirst, quotesByDay, dayIndexInNewest)
          : null;
      const parts = blendUsFlow(q.turnover, q.changePct, rvol);
      flow += parts.flow;
      inflow += parts.inflow;
      outflow += parts.outflow;
    }

    if (wSum <= 0) continue;
    const o = index * (1 + retO / wSum);
    const h = index * (1 + retH / wSum);
    const l = index * (1 + retL / wSum);
    const c = index * (1 + retC / wSum);
    candles.push({
      date: ymdToIso(ymd),
      open: round2(o),
      high: round2(Math.max(o, h, c)),
      low: round2(Math.min(o, l, c)),
      close: round2(c),
      amount: round1(amount),
      flow: round1(flow),
      inflow: round1(inflow),
      outflow: round1(outflow),
      changePct: round2(chgN ? chgSum / chgN : ((c - index) / index) * 100),
    });
    index = c;
  }

  if (candles.length < 5) return null;

  const payload: UsSectorKlinePayload = {
    sectorId: def.id,
    sectorName: def.name,
    candles,
    base: 100,
    quoteDays: days,
    builtAt: new Date().toISOString(),
    formula: FORMULA,
    source: "live",
    market: "us",
    flowLabel: "美股金流（成交×漲跌＋相對成交量）",
  };
  await writeUsCacheFile(usKlineCacheName(def.id), payload);
  memSet(payload);
  return payload;
}

export async function warmUsSectorKlineCaches(
  defs: SectorDef[] = US_SECTOR_UNIVERSE,
  options?: { onProgress?: (done: number, total: number) => void },
) {
  let done = 0;
  for (const def of defs) {
    try {
      await buildUsSectorKline(def.id, { force: true });
    } catch (err) {
      console.warn(`[us-kline] warm ${def.id} failed`, err);
    }
    done++;
    options?.onProgress?.(done, defs.length);
  }
}

export async function getUsSectorKline(
  sectorId: string,
  options?: { days?: number; force?: boolean },
): Promise<UsSectorKlinePayload | null> {
  if (!options?.force) {
    const cached = await readUsSectorKlineCache(sectorId);
    if (cached?.candles?.length) {
      const need = options?.days ?? 0;
      if (!need || cached.candles.length >= Math.min(need, 20)) return cached;
    }
  }
  return buildUsSectorKline(sectorId, options);
}
