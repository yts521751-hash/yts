/**
 * 台股盤後產業資金流入／流出（EOD）。
 * 口徑＝本站混合金流（80% 成交×softSign + 20% 法人×價），依官方產業全成分加總；
 * 題材列為可選對照（人工宇宙，非全市場細產業）。
 */

import {
  computeIndustryFlowRows,
  type IndustryFlowDayBundle,
  type IndustryFlowRow,
} from "@/lib/industry-flow-compute";
import {
  buildFullIndustrySectors,
} from "@/lib/resolve-universe";
import { ROTATION_THEME_UNIVERSE } from "@/lib/rotation-theme-universe";
import type { SectorDef } from "@/lib/sector-universe";
import type { MarketBrief } from "@/lib/types";
import {
  getCachedDayInsti,
  getCachedDayQuotes,
  listCachedTradingDays,
  listRecentTradingDays,
  loadMergedInstiDay,
  loadMergedQuotesDay,
  readCacheFile,
  writeCacheFile,
  ymdToIso,
  type InstiRow,
  type QuoteRow,
} from "@/lib/tw-market";

export const INDUSTRY_FLOW_CACHE = "industry-flow-active.json";
const TAXONOMY = "ai-supply-chain+isin-official" as const;

export type { IndustryFlowRow } from "@/lib/industry-flow-compute";

export type IndustryFlowPayload = {
  brief: MarketBrief;
  rows: IndustryFlowRow[];
  tradingDays: string[];
  source: "twse+tpex" | "cache";
  builtAt: string;
  formula: "blend-80-20";
  metricNote: string;
  taxonomy: typeof TAXONOMY;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function taipeiClock() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(new Date());
  const get = (ty: string) => parts.find((p) => p.type === ty)?.value ?? "";
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const weekday = get("weekday");
  const ymd = `${get("year")}${get("month")}${get("day")}`;
  const isWeekday = !["Sat", "Sun"].includes(weekday);
  const mins = hour * 60 + minute;
  return { hour, minute, mins, isWeekday, ymd };
}

async function loadDayBundles(
  needDays: number,
  cacheOnly: boolean,
  watchCodes: Set<string>,
): Promise<IndustryFlowDayBundle[]> {
  const tradingDaysRaw = cacheOnly
    ? await listCachedTradingDays(needDays, 50)
    : await listRecentTradingDays(needDays, 50);
  const clock = taipeiClock();
  const tradingDays =
    clock.isWeekday && clock.mins < 18 * 60
      ? tradingDaysRaw.filter((d) => d !== clock.ymd)
      : tradingDaysRaw;

  const dayData: IndustryFlowDayBundle[] = [];
  for (const ymd of tradingDays) {
    let quotesMap: Map<string, QuoteRow> | null = null;
    let insti: Map<string, InstiRow> = new Map();
    let indexChangePct: number | null = null;

    if (cacheOnly) {
      quotesMap = await getCachedDayQuotes(ymd);
      if (!quotesMap?.size) continue;
      insti = (await getCachedDayInsti(ymd)) ?? new Map();
    } else {
      const bundle = await loadMergedQuotesDay(ymd);
      if (!bundle?.quotes?.length) continue;
      quotesMap = new Map(bundle.quotes.map((q) => [q.code, q]));
      insti =
        (await loadMergedInstiDay(ymd, { watchCodes })) ??
        new Map<string, InstiRow>();
      indexChangePct = bundle.indexChangePct ?? null;
    }

    dayData.push({
      ymd,
      quotes: quotesMap,
      insti,
      indexChangePct,
    });
    if (dayData.length >= needDays) break;
  }
  return dayData;
}

export async function rebuildIndustryFlowPayload(options?: {
  days?: number;
  cacheOnly?: boolean;
}): Promise<IndustryFlowPayload> {
  const needDays = options?.days ?? 20;
  const cacheOnly = options?.cacheOnly !== false;

  let dayData = await loadDayBundles(needDays, cacheOnly, new Set());
  if (dayData.length < 5) {
    throw new Error("產業流：成交日資料不足（需至少 5 個交易日快取）");
  }

  const latest = dayData[0];
  const industries = await buildFullIndustrySectors(latest.quotes);
  // 產業流預設是供應鏈輪動視角：只取人工審核的多標籤 AI 群，
  // 不混入新聞自動題材或首頁的泛產業題材，避免名稱／成分不穩定。
  const themes: SectorDef[] = ROTATION_THEME_UNIVERSE;

  const universe = [...industries, ...themes];
  const watchCodes = new Set(
    universe.flatMap((s) => s.members.map((m) => m.code)),
  );

  if (!cacheOnly) {
    dayData = await loadDayBundles(needDays, false, watchCodes);
    if (dayData.length < 5) {
      throw new Error("產業流：重抓日資料不足");
    }
  }

  const rows = computeIndustryFlowRows(dayData, universe).sort(
    (a, b) => b.dayFlow - a.dayFlow,
  );

  const { computeFearGauge } = await import("@/lib/fear-gauge");
  const fear = await computeFearGauge(
    dayData
      .map((d) => d.indexChangePct)
      .filter((x): x is number => x != null && Number.isFinite(x)),
  );
  const indexChangePct = dayData[0].indexChangePct ?? 0;

  const payload: IndustryFlowPayload = {
    brief: {
      date: ymdToIso(dayData[0].ymd),
      indexChangePct: round2(indexChangePct),
      fearLabel: fear.label,
      fearScore: fear.score,
      updatedAt: new Date().toLocaleString("zh-TW", { hour12: false }),
      isDemo: false,
    },
    rows,
    tradingDays: dayData.map((d) => d.ymd),
    source: "twse+tpex",
    builtAt: new Date().toISOString(),
    formula: "blend-80-20",
    metricNote:
      "混合金流＝80%×(成交×漲跌 softSign)＋20%×三大法人買賣超金額；產業為 ISIN 全成分加總（非 toAlpha 成交占比偏差）",
    taxonomy: TAXONOMY,
  };

  await writeCacheFile(INDUSTRY_FLOW_CACHE, payload);
  return payload;
}

export async function getIndustryFlowPayload(): Promise<IndustryFlowPayload | null> {
  const cached = await readCacheFile<IndustryFlowPayload>(INDUSTRY_FLOW_CACHE);
  // 旧快取曾以官方 ISIN／泛題材為主；分類版本不一致不可沿用。
  if (cached?.rows?.length && cached.taxonomy === TAXONOMY) {
    return { ...cached, source: "cache" };
  }
  return null;
}

export async function buildIndustryFlowPayload(options?: {
  force?: boolean;
  cacheOnly?: boolean;
}): Promise<IndustryFlowPayload> {
  if (!options?.force) {
    const cached = await getIndustryFlowPayload();
    if (cached) return cached;
  }
  return rebuildIndustryFlowPayload({
    cacheOnly: options?.cacheOnly !== false,
  });
}
