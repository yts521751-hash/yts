/**
 * 美股產業均線掃描（站上 MA5／MA10）。
 */

import type { MaScreenerPayload, MaScreenerRow } from "@/lib/ma-screener-types";
import { US_SECTOR_UNIVERSE } from "@/lib/us-sector-universe";
import { getUsSectorKline } from "@/lib/sector-kline-us";
import {
  US_MA_SCREENER_CACHE,
  readUsCacheFile,
  writeUsCacheFile,
} from "@/lib/us-market";

function sma(vals: number[], n: number): number | null {
  if (vals.length < n) return null;
  const slice = vals.slice(-n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

export async function buildUsMaScreener(options?: {
  force?: boolean;
}): Promise<MaScreenerPayload & { market: "us" }> {
  if (!options?.force) {
    const cached = await readUsCacheFile<MaScreenerPayload & { market?: "us" }>(
      US_MA_SCREENER_CACHE,
    );
    if (cached?.rows?.length) {
      return { ...cached, market: "us", source: "cache" };
    }
  }

  const rows: MaScreenerRow[] = [];
  for (const def of US_SECTOR_UNIVERSE.filter((s) => s.kind !== "theme")) {
    const kline = await getUsSectorKline(def.id, { force: Boolean(options?.force) });
    const candles = kline?.candles ?? [];
    if (candles.length < 10) continue;
    const closes = candles.map((c) => c.close);
    const close = closes[closes.length - 1];
    const ma5 = sma(closes, 5);
    const ma10 = sma(closes, 10);
    const ma20 = sma(closes, 20);
    const above5 = ma5 != null && close > ma5;
    const above10 = ma10 != null && close > ma10;
    const above20 = ma20 != null && close > ma20;
    const last5 = candles.slice(-5);
    rows.push({
      id: def.id,
      name: def.name,
      close: Math.round(close * 100) / 100,
      ma5: ma5 != null ? Math.round(ma5 * 100) / 100 : null,
      ma10: ma10 != null ? Math.round(ma10 * 100) / 100 : null,
      ma20: ma20 != null ? Math.round(ma20 * 100) / 100 : null,
      bias5:
        ma5 != null ? Math.round(((close - ma5) / ma5) * 10000) / 100 : null,
      bias10:
        ma10 != null ? Math.round(((close - ma10) / ma10) * 10000) / 100 : null,
      bias20:
        ma20 != null ? Math.round(((close - ma20) / ma20) * 10000) / 100 : null,
      above5,
      above10,
      above20,
      aboveAll: above5 && above10,
      aboveCount: [above5, above10].filter(Boolean).length,
      amt5: Math.round(last5.reduce((s, c) => s + c.amount, 0) * 10) / 10,
      flow5: Math.round(last5.reduce((s, c) => s + c.flow, 0) * 10) / 10,
      asOf: candles[candles.length - 1]?.date ?? null,
      bars: candles.length,
    });
  }

  rows.sort((a, b) => b.aboveCount - a.aboveCount || b.flow5 - a.flow5);
  const payload = {
    rows,
    builtAt: new Date().toISOString(),
    asOf: rows[0]?.asOf ?? null,
    source: "mixed" as const,
    counts: {
      ma5: rows.filter((r) => r.above5).length,
      ma10: rows.filter((r) => r.above10).length,
      ma20: rows.filter((r) => r.above20).length,
      all2: rows.filter((r) => r.aboveAll).length,
      total: rows.length,
    },
    market: "us" as const,
  };
  await writeUsCacheFile(US_MA_SCREENER_CACHE, payload);
  return payload;
}

export async function getUsMaScreener(options?: { force?: boolean }) {
  return buildUsMaScreener(options);
}
