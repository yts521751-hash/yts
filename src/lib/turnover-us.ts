/**
 * 美股成交金額排行（成值）。
 *
 * 公式：dayAmtYi = (收盤價 USD × Nasdaq Share Volume) / 1e8
 * 單位：億美元（1e8 USD）。
 *
 * 宇宙（系統性，非精選手動名單）：
 * 1) Nasdaq 全市場 screener 依美元成交額挑流動普通股（＋movers 補強）
 * 2) 對候選抓 quote info 官方量，重算 dayAmt 後取 Top N
 * 3) screener 失敗時回退本機 us/quotes-*（精選宇宙日檔）
 *
 * 為何用 Nasdaq volume：Yahoo daily chart volume 常略低於交易所／媒體口徑。
 */

import {
  US_TURNOVER_CACHE,
  getUsCachedDayQuotes,
  isUsCommonStock,
  listUsCachedTradingDays,
  readUsCacheFile,
  writeUsCacheFile,
  ymdToIso,
} from "@/lib/us-market";
import {
  cleanNasdaqCompanyName,
  fetchNasdaqLiquidDollarVolumeUniverse,
  fetchNasdaqQuoteInfoMap,
  type NasdaqScreenerRow,
} from "@/lib/nasdaq-us";
import { resolveUsDisplayNames } from "@/lib/us-company-names";

export type UsTurnoverRow = {
  rank: number;
  code: string;
  /** 列表主欄：英文（中文） */
  name: string;
  /** 英文全名／短名 */
  nameEn: string;
  /** 中文短名 */
  nameZh: string;
  close: number;
  changePct: number;
  /** 億美元（USD dollar volume / 1e8） */
  dayAmt: number;
  volume: number;
  /** volume 來源 */
  volumeSource?: "nasdaq" | "yahoo" | "screener";
};

export type UsTurnoverPayload = {
  date: string;
  ymd: string;
  rows: UsTurnoverRow[];
  builtAt: string;
  source: "cache" | "rebuilt";
  amountBasis: string;
  /** 顯示單位說明 */
  unit: "億美元";
  market: "us";
  /** 候選宇宙來源說明 */
  universeBasis?: string;
  universeSize?: number;
};

export const AMOUNT_BASIS =
  "美股成值＝收盤價(USD)×Nasdaq成交股數÷1e8（單位：億美元；漲跌幅＝與收盤同場次：優先 Nasdaq quote percentageChange／last vs prior close，否則 screener，再否則 Yahoo 日檔；宇宙＝Nasdaq screener／movers 依美元成交額之流動普通股，非精選手動名單；Nasdaq quote 失敗時回退 screener／Yahoo volume；不含盤後）";

export const UNIVERSE_BASIS =
  "Nasdaq screener download＋MostActiveByDollarVolume → 濾 ETF／權證 → 依美元成交額取候選 → quote info 官方量重排 Top N";

/** 快取失效標記：舊成值列把 Yahoo 日檔漲跌幅配 Nasdaq 收盤，場次錯位 */
export const CHANGE_PCT_BASIS_MARKER = "percentageChange";

/** 1 億美元 */
export const US_YI_USD = 1e8;
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** 美元成交額 → 億美元 */
export function usdTurnoverToYi(dollarVolume: number): number {
  return dollarVolume / US_YI_USD;
}

/** last + netChange → 相對前收漲跌幅（%） */
export function changePctFromLastAndNet(
  last: number,
  netChange: number,
): number | null {
  if (!(last > 0) || !Number.isFinite(netChange) || netChange === 0) return null;
  const prior = last - netChange;
  if (!(prior > 0)) return null;
  return (netChange / prior) * 100;
}

/**
 * 漲跌幅必須與收盤價同場次：
 * - 收盤來自 Nasdaq → 優先 Nasdaq percentageChange／netChange
 * - 收盤來自 Yahoo 日檔 → 用該日 changePct
 * - 否則 screener → 最後才回退 Yahoo（避免 Nasdaq 收 × Yahoo 昨漲跌）
 */
export function resolveUsTurnoverChangePct(args: {
  closeSource: "nasdaq" | "yahoo" | "screener";
  nasdaqPct?: number | null;
  nasdaqNet?: number | null;
  nasdaqLast?: number | null;
  screenerPct?: number;
  screenerNet?: number;
  screenerLast?: number;
  cachedPct?: number | null;
}): number {
  const fromNasdaq =
    (args.nasdaqPct != null && Number.isFinite(args.nasdaqPct)
      ? args.nasdaqPct
      : null) ??
    (args.nasdaqLast != null && args.nasdaqNet != null
      ? changePctFromLastAndNet(args.nasdaqLast, args.nasdaqNet)
      : null);
  const fromScreener =
    args.screenerPct != null && args.screenerPct !== 0
      ? args.screenerPct
      : args.screenerLast != null && args.screenerNet != null
        ? changePctFromLastAndNet(args.screenerLast, args.screenerNet)
        : null;
  const fromCache =
    args.cachedPct != null && Number.isFinite(args.cachedPct)
      ? args.cachedPct
      : null;

  if (args.closeSource === "nasdaq") {
    return fromNasdaq ?? fromScreener ?? fromCache ?? 0;
  }
  if (args.closeSource === "yahoo") {
    return fromCache ?? fromScreener ?? fromNasdaq ?? 0;
  }
  return fromScreener ?? fromNasdaq ?? fromCache ?? 0;
}

function usTurnoverCacheStale(
  cached: UsTurnoverPayload | null | undefined,
): boolean {
  if (!cached?.amountBasis) return false;
  return (
    !cached.amountBasis.includes("Nasdaq") ||
    !cached.amountBasis.includes("screener") ||
    !cached.amountBasis.includes(CHANGE_PCT_BASIS_MARKER)
  );
}

/** 候選池大小：略大於 Top N，讓 quote 校正後名次可上下移動 */
export const US_TURNOVER_CANDIDATE_POOL = 120;

type Candidate = {
  code: string;
  name: string;
  close: number;
  changePct: number;
  volume: number;
  volumeSource: "nasdaq" | "yahoo" | "screener";
  dollarVolume: number;
};

export type UsTurnoverQuoteInfo = {
  volume: number | null;
  lastPrice: number | null;
  companyName?: string;
  percentageChange?: number | null;
  netChange?: number | null;
};

/**
 * 純函式：把 screener 列＋quote 官方量合成最終排序列（可單測）。
 * quote 有量 → 用 quote close×vol；否則用 screener dollarVolume。
 */
export function rankUsTurnoverCandidates(
  screenerRows: NasdaqScreenerRow[],
  quoteByCode: Map<string, UsTurnoverQuoteInfo>,
  options?: {
    limit?: number;
    cachedQuotes?: Map<
      string,
      { close: number; changePct: number; volume?: number; name?: string }
    >;
  },
): Array<Candidate & { nameEn: string; nameZh: string; displayName: string }> {
  const want = Math.min(100, Math.max(10, options?.limit ?? 50));
  const cached = options?.cachedQuotes;

  const enriched = screenerRows.map((row) => {
    const code = row.symbol.toUpperCase();
    const q = quoteByCode.get(code);
    const cachedQ = cached?.get(code);
    const nasdaqVol =
      q?.volume != null && q.volume > 0 ? q.volume : null;
    const nasdaqLast =
      q?.lastPrice != null && q.lastPrice > 0 ? q.lastPrice : null;
    const cachedClose =
      cachedQ?.close != null && cachedQ.close > 0 ? cachedQ.close : null;
    const closeSource: "nasdaq" | "yahoo" | "screener" = nasdaqLast
      ? "nasdaq"
      : cachedClose
        ? "yahoo"
        : "screener";
    const close = nasdaqLast ?? cachedClose ?? row.lastSale;
    const volume =
      nasdaqVol ??
      (cachedQ?.volume != null && cachedQ.volume > 0 ? cachedQ.volume : null) ??
      row.volume;
    const volumeSource: Candidate["volumeSource"] = nasdaqVol
      ? "nasdaq"
      : cachedQ?.volume != null && cachedQ.volume > 0
        ? "yahoo"
        : "screener";
    const dollar = Math.max(0, close) * Math.max(0, volume);
    const changePct = resolveUsTurnoverChangePct({
      closeSource,
      nasdaqPct: q?.percentageChange,
      nasdaqNet: q?.netChange,
      nasdaqLast,
      screenerPct: row.pctChange,
      screenerNet: row.netChange,
      screenerLast: row.lastSale,
      cachedPct: cachedQ?.changePct,
    });
    const names = resolveUsDisplayNames({
      code,
      yahooName: cachedQ?.name || row.name,
      nasdaqName: cleanNasdaqCompanyName(q?.companyName),
      longName:
        cleanNasdaqCompanyName(q?.companyName) ||
        cachedQ?.name ||
        row.name,
    });
    return {
      code,
      name: names.name,
      nameEn: names.nameEn,
      nameZh: names.nameZh,
      displayName: names.name,
      close: round2(close),
      changePct: round2(changePct),
      volume,
      volumeSource,
      dollarVolume: dollar,
    };
  });

  enriched.sort(
    (a, b) =>
      b.dollarVolume - a.dollarVolume || a.code.localeCompare(b.code),
  );
  return enriched.slice(0, want);
}

export async function buildUsTurnoverRanking(
  limit = 50,
  options?: { force?: boolean },
): Promise<UsTurnoverPayload | null> {
  const want = Math.min(100, Math.max(10, limit));
  if (!options?.force) {
    const cached = await readUsCacheFile<UsTurnoverPayload>(US_TURNOVER_CACHE);
    const staleBasis = usTurnoverCacheStale(cached);
    const missingNames = cached?.rows?.some((r) => !r.nameEn || !r.nameZh);
    if (cached?.rows?.length && !staleBasis && !missingNames) {
      return {
        ...cached,
        rows: cached.rows.slice(0, want),
        source: "cache",
        unit: "億美元",
      };
    }
  }

  const days = await listUsCachedTradingDays(1, 40);
  const ymd = days[0] ?? null;
  const cachedQuotes = ymd ? await getUsCachedDayQuotes(ymd) : null;

  // 1) 資料驅動候選宇宙（非精選板塊名單）
  let universe: NasdaqScreenerRow[] = [];
  let universeSource: "screener" | "cache-fallback" = "screener";
  try {
    universe = await fetchNasdaqLiquidDollarVolumeUniverse(
      Math.max(US_TURNOVER_CANDIDATE_POOL, want * 2),
      { isCommonStock: isUsCommonStock },
    );
  } catch (err) {
    console.warn("[us-turnover] screener universe failed", err);
  }

  // 回退：本機日檔（精選宇宙）— 僅當 screener 全掛
  if (universe.length < Math.min(30, want)) {
    universeSource = "cache-fallback";
    if (!cachedQuotes?.size) return null;
    universe = [...cachedQuotes.values()]
      .filter((q) => isUsCommonStock(q.code, q.name) && q.turnover > 0)
      .map((q) => ({
        symbol: q.code.toUpperCase(),
        name: q.name,
        lastSale: q.close,
        netChange: 0,
        pctChange: q.changePct,
        volume: q.volume ?? 0,
        marketCap: null,
        dollarVolume: q.turnover,
        sector: "",
        industry: "",
      }))
      .sort((a, b) => b.dollarVolume - a.dollarVolume)
      .slice(0, US_TURNOVER_CANDIDATE_POOL);
  }

  if (!universe.length) return null;

  // 2) 官方量校正（決定最終名次與億美元）
  const nasdaqMap = await fetchNasdaqQuoteInfoMap(
    universe.map((r) => r.symbol),
    8,
  );

  const cachedMap = new Map<
    string,
    { close: number; changePct: number; volume?: number; name?: string }
  >();
  if (cachedQuotes) {
    for (const [code, q] of cachedQuotes) {
      cachedMap.set(code.toUpperCase(), {
        close: q.close,
        changePct: q.changePct,
        volume: q.volume,
        name: q.name,
      });
    }
  }

  const ranked = rankUsTurnoverCandidates(universe, nasdaqMap, {
    limit: want,
    cachedQuotes: cachedMap,
  });

  const rows: UsTurnoverRow[] = ranked.map((r, i) => ({
    rank: i + 1,
    code: r.code,
    name: r.displayName,
    nameEn: r.nameEn,
    nameZh: r.nameZh,
    close: r.close,
    changePct: r.changePct,
    dayAmt: round1(usdTurnoverToYi(r.dollarVolume)),
    volume: r.volume,
    volumeSource: r.volumeSource,
  }));

  const payload: UsTurnoverPayload = {
    date: ymd ? ymdToIso(ymd) : new Date().toISOString().slice(0, 10),
    ymd: ymd ?? new Date().toISOString().slice(0, 10).replace(/-/g, ""),
    rows,
    builtAt: new Date().toISOString(),
    source: "rebuilt",
    amountBasis: AMOUNT_BASIS,
    unit: "億美元",
    market: "us",
    universeBasis:
      universeSource === "screener"
        ? UNIVERSE_BASIS
        : "fallback: us/quotes day file (curated)",
    universeSize: universe.length,
  };
  await writeUsCacheFile(US_TURNOVER_CACHE, payload);
  return payload;
}

export async function getUsTurnoverRanking(
  limit = 50,
  options?: { force?: boolean },
): Promise<UsTurnoverPayload | null> {
  const want = Math.min(100, Math.max(10, limit));
  if (!options?.force) {
    const cached = await readUsCacheFile<UsTurnoverPayload>(US_TURNOVER_CACHE);
    const staleBasis = usTurnoverCacheStale(cached);
    const missingNames = cached?.rows?.some((r) => !r.nameEn || !r.nameZh);
    if (cached?.rows?.length && !staleBasis && !missingNames) {
      return {
        ...cached,
        rows: cached.rows.slice(0, want),
        source: "cache",
        unit: "億美元",
      };
    }
  }
  return buildUsTurnoverRanking(want, options);
}
