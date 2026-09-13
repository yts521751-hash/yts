import "server-only";
import { lastSma, biasPct } from "@/lib/ma";
import { readSectorKlineCache, buildSectorKline } from "@/lib/sector-kline";
import { getActiveFlowPayload } from "@/lib/build-flow";
import type { SectorDef } from "@/lib/sector-universe";
import { lookupSectorDef } from "@/lib/resolve-universe";
import type { MaScreenerPayload, MaScreenerRow } from "@/lib/ma-screener-types";

export type { MaScreenerPayload, MaScreenerRow };

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

/** 從金流 active 取出官方產業清單 */
export async function listIndustryDefs(): Promise<SectorDef[]> {
  const flow = await getActiveFlowPayload();
  const industries =
    flow?.sectors?.filter((s) => s.kind === "industry" && s.id.startsWith("ind-")) ??
    [];
  const defs: SectorDef[] = [];
  for (const s of industries) {
    const def = await lookupSectorDef(s.id);
    if (def?.members?.length) defs.push(def);
  }
  return defs;
}

function rowFromCloses(
  id: string,
  name: string,
  closes: number[],
  asOf: string | null,
): MaScreenerRow | null {
  if (closes.length < 5) return null;
  const close = closes[closes.length - 1];
  const ma5 = lastSma(closes, 5);
  const ma10 = lastSma(closes, 10);
  const ma20 = lastSma(closes, 20);
  // 「站上」採收盤 ≥ 均線
  const above5 = ma5 != null && close >= ma5;
  const above10 = ma10 != null && close >= ma10;
  const above20 = ma20 != null && close >= ma20;
  const aboveCount = Number(above5) + Number(above10) + Number(above20);
  return {
    id,
    name,
    close: Math.round(close * 100) / 100,
    ma5: ma5 != null ? Math.round(ma5 * 100) / 100 : null,
    ma10: ma10 != null ? Math.round(ma10 * 100) / 100 : null,
    ma20: ma20 != null ? Math.round(ma20 * 100) / 100 : null,
    bias5: biasPct(close, ma5) != null ? Math.round(biasPct(close, ma5)! * 100) / 100 : null,
    bias10:
      biasPct(close, ma10) != null ? Math.round(biasPct(close, ma10)! * 100) / 100 : null,
    bias20:
      biasPct(close, ma20) != null ? Math.round(biasPct(close, ma20)! * 100) / 100 : null,
    above5,
    above10,
    above20,
    aboveAll: above5 && above10 && above20,
    aboveCount,
    asOf,
    bars: closes.length,
  };
}

/**
 * 掃描官方產業 K 線：指數收盤相對 MA5／10／20 的位置。
 * 優先讀快取；缺資料時才背景補建（不阻塞整批）。
 */
export async function buildMaScreener(options?: {
  forceRebuildMissing?: boolean;
}): Promise<MaScreenerPayload> {
  const defs = await listIndustryDefs();
  const rows = (
    await mapPool(defs, 8, async (def) => {
      let payload = await readSectorKlineCache(def.id);
      if (
        (!payload?.candles || payload.candles.length < 20) &&
        options?.forceRebuildMissing
      ) {
        payload = await buildSectorKline(def.id, 80, { def, force: true }).catch(() => null);
      }
      if (!payload?.candles?.length) return null;
      const closes = payload.candles.map((c) => c.close);
      const asOf = payload.candles[payload.candles.length - 1]?.date ?? null;
      return rowFromCloses(def.id, def.name, closes, asOf);
    })
  ).filter((r): r is MaScreenerRow => Boolean(r));

  rows.sort((a, b) => {
    const score =
      Number(b.aboveAll) * 8 +
      Number(b.above20) * 4 +
      Number(b.above10) * 2 +
      Number(b.above5) -
      (Number(a.aboveAll) * 8 +
        Number(a.above20) * 4 +
        Number(a.above10) * 2 +
        Number(a.above5));
    if (score !== 0) return score;
    return (b.bias20 ?? -999) - (a.bias20 ?? -999);
  });

  const asOf =
    rows
      .map((r) => r.asOf)
      .filter((d): d is string => Boolean(d))
      .sort()
      .at(-1) ?? null;

  return {
    rows,
    builtAt: new Date().toISOString(),
    asOf,
    source: "cache",
    counts: {
      ma5: rows.filter((r) => r.above5).length,
      ma10: rows.filter((r) => r.above10).length,
      ma20: rows.filter((r) => r.above20).length,
      all3: rows.filter((r) => r.aboveAll).length,
      total: rows.length,
    },
  };
}
