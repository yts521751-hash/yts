import "server-only";
import { lastSma, biasPct } from "@/lib/ma";
import { readSectorKlineCache, buildSectorKline } from "@/lib/sector-kline";
import { getActiveFlowPayload } from "@/lib/build-flow";
import type { SectorDef } from "@/lib/sector-universe";
import { lookupSectorDef } from "@/lib/resolve-universe";
import { loadIndustryMap, industrySectorId } from "@/lib/industry-map";
import {
  readCacheFile,
  writeCacheFile,
} from "@/lib/tw-market";
import type { MaScreenerPayload, MaScreenerRow } from "@/lib/ma-screener-types";

export type { MaScreenerPayload, MaScreenerRow };

const MA_SCREENER_CACHE = "ma-screener-active.json";

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

/** 從金流 active 取出官方產業；若金流尚未暖機，直接從產業對照表組清單 */
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
  if (defs.length >= 8) return defs;

  // 後備：不依賴金流快取，直接用官方產業對照
  const map = await loadIndustryMap().catch(() => null);
  if (!map?.stocks?.length) return defs;

  const byIndustry = new Map<string, { code: string; name: string }[]>();
  for (const s of map.stocks) {
    const list = byIndustry.get(s.industry) ?? [];
    if (list.length < 12) list.push({ code: s.code, name: s.name });
    byIndustry.set(s.industry, list);
  }

  const fallback: SectorDef[] = [];
  for (const [industry, members] of byIndustry) {
    if (members.length < 4) continue;
    if ((industry === "其他" || industry === "其他業") && members.length < 8) continue;
    fallback.push({
      id: industrySectorId(industry),
      name: industry,
      basis: "官方產業對照（均線掃描後備）",
      kind: "industry",
      members,
    });
  }
  return fallback.length ? fallback : defs;
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

/** 依收盤／均線重算站上旗標，避免舊快取欄位缺漏或錯位導致月線／三線計成 0 */
function normalizeRow(r: MaScreenerRow): MaScreenerRow {
  const above5 = r.ma5 != null && r.close >= r.ma5;
  const above10 = r.ma10 != null && r.close >= r.ma10;
  const above20 = r.ma20 != null && r.close >= r.ma20;
  return {
    ...r,
    above5,
    above10,
    above20,
    aboveAll: above5 && above10 && above20,
    aboveCount: Number(above5) + Number(above10) + Number(above20),
  };
}

function finalize(rows: MaScreenerRow[], source: MaScreenerPayload["source"]): MaScreenerPayload {
  const normalized = rows.map(normalizeRow);
  normalized.sort((a, b) => {
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
    normalized
      .map((r) => r.asOf)
      .filter((d): d is string => Boolean(d))
      .sort()
      .at(-1) ?? null;

  return {
    rows: normalized,
    builtAt: new Date().toISOString(),
    asOf,
    source,
    counts: {
      ma5: normalized.filter((r) => r.above5).length,
      ma10: normalized.filter((r) => r.above10).length,
      ma20: normalized.filter((r) => r.above20).length,
      all3: normalized.filter((r) => r.aboveAll).length,
      total: normalized.length,
    },
  };
}

export async function readMaScreenerCache(): Promise<MaScreenerPayload | null> {
  const cached = await readCacheFile<MaScreenerPayload>(MA_SCREENER_CACHE);
  if (!cached?.rows?.length) return null;
  // 舊快取若缺 counts 或計數與列不一致，依列重算後回寫
  const fixed = finalize(cached.rows, cached.source ?? "cache");
  const same =
    cached.counts?.ma20 === fixed.counts.ma20 &&
    cached.counts?.all3 === fixed.counts.all3 &&
    cached.counts?.total === fixed.counts.total;
  if (!same) {
    await writeCacheFile(MA_SCREENER_CACHE, {
      ...fixed,
      builtAt: cached.builtAt,
      asOf: cached.asOf ?? fixed.asOf,
    }).catch(() => null);
  }
  return {
    ...fixed,
    builtAt: cached.builtAt,
    asOf: cached.asOf ?? fixed.asOf,
    source: "cache",
  };
}

/**
 * 掃描官方產業 K 線：指數收盤相對 MA5／10／20。
 * - 先讀磁碟掃描快取（秒開）
 * - 缺 K 線時自動補建（冷啟動也要有資料，不再等使用者按強制）
 */
export async function buildMaScreener(options?: {
  forceRebuildMissing?: boolean;
  skipDiskCache?: boolean;
}): Promise<MaScreenerPayload> {
  if (!options?.skipDiskCache && !options?.forceRebuildMissing) {
    const cached = await readMaScreenerCache();
    if (cached?.rows?.length) return { ...cached, source: "cache" };
  }

  const defs = await listIndustryDefs();
  // 冷啟動或強制：缺 K 線就補；一般請求若完全沒列也補
  const shouldFillMissing = Boolean(options?.forceRebuildMissing) || defs.length > 0;

  const rows = (
    await mapPool(defs, 6, async (def) => {
      let payload = await readSectorKlineCache(def.id);
      const needBuild =
        shouldFillMissing && (!payload?.candles || payload.candles.length < 20);
      if (needBuild) {
        payload = await buildSectorKline(def.id, 80, {
          def,
          force: Boolean(options?.forceRebuildMissing),
        }).catch(() => null);
      }
      if (!payload?.candles?.length) return null;
      const closes = payload.candles.map((c) => c.close);
      const asOf = payload.candles[payload.candles.length - 1]?.date ?? null;
      return rowFromCloses(def.id, def.name, closes, asOf);
    })
  ).filter((r): r is MaScreenerRow => Boolean(r));

  const payload = finalize(rows, rows.length ? "mixed" : "cache");
  if (payload.rows.length) {
    await writeCacheFile(MA_SCREENER_CACHE, payload).catch(() => null);
  }
  return payload;
}

/** 背景暖機：不阻塞 HTTP */
export function requestMaScreenerWarmup(reason = "boot"): {
  started: boolean;
  alreadyRunning: boolean;
} {
  const g = globalThis as typeof globalThis & {
    __jinliuMaWarm?: { running: boolean };
  };
  if (!g.__jinliuMaWarm) g.__jinliuMaWarm = { running: false };
  if (g.__jinliuMaWarm.running) return { started: false, alreadyRunning: true };
  g.__jinliuMaWarm.running = true;
  void buildMaScreener({ forceRebuildMissing: true, skipDiskCache: true })
    .then((p) => {
      console.log(`[ma-screener] warm (${reason}): rows=${p.rows.length}`);
    })
    .catch((err) => {
      console.error(`[ma-screener] warm failed (${reason}):`, err);
    })
    .finally(() => {
      g.__jinliuMaWarm!.running = false;
    });
  return { started: true, alreadyRunning: false };
}
