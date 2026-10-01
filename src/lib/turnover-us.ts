/**
 * 美股成交金額排行（成值）。
 *
 * 公式：dayAmtYi = (收盤價 USD × Nasdaq Share Volume) / 1e8
 * 單位：億美元（1e8 USD）。
 *
 * 為何用 Nasdaq volume：Yahoo daily chart volume 常略低於交易所／媒體口徑；
 * 以 MU/NVDA/AAPL/META 驗證，Nasdaq volume × close 可對齊常見「成值」參考值。
 * Nasdaq 失敗時回退 Yahoo chart volume（close×volume/1e8）。
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
  fetchNasdaqQuoteInfoMap,
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
  volumeSource?: "nasdaq" | "yahoo";
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
};

export const AMOUNT_BASIS =
  "美股成值＝收盤價(USD)×Nasdaq成交股數÷1e8（單位：億美元；Nasdaq 失敗時回退 Yahoo daily bar volume；不含盤後）";

/** 1 億美元 */
export const US_YI_USD = 1e8;
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** 美元成交額 → 億美元 */
export function usdTurnoverToYi(dollarVolume: number): number {
  return dollarVolume / US_YI_USD;
}

export async function buildUsTurnoverRanking(
  limit = 50,
  options?: { force?: boolean },
): Promise<UsTurnoverPayload | null> {
  const want = Math.min(100, Math.max(10, limit));
  if (!options?.force) {
    const cached = await readUsCacheFile<UsTurnoverPayload>(US_TURNOVER_CACHE);
    // 舊快取缺 nameEn／或仍寫 Yahoo-only 口徑 → 強制重算
    const staleBasis =
      cached?.amountBasis &&
      !cached.amountBasis.includes("Nasdaq");
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
  if (!days.length) return null;
  const quotes = await getUsCachedDayQuotes(days[0]);
  if (!quotes?.size) return null;

  const candidates = [...quotes.values()]
    .filter((q) => isUsCommonStock(q.code, q.name) && q.turnover > 0)
    .sort((a, b) => b.turnover - a.turnover);

  // 對候選抓 Nasdaq 官方量（宇宙約百檔，併發可接受）
  const nasdaqMap = await fetchNasdaqQuoteInfoMap(
    candidates.map((q) => q.code),
    6,
  );

  const enriched = candidates.map((q) => {
    const code = q.code.toUpperCase();
    const nq = nasdaqMap.get(code);
    const nasdaqVol =
      nq?.volume != null && nq.volume > 0 ? nq.volume : null;
    const volume = nasdaqVol ?? q.volume ?? 0;
    const volumeSource: "nasdaq" | "yahoo" = nasdaqVol ? "nasdaq" : "yahoo";
    const dollar = q.close * Math.max(0, volume);
    const names = resolveUsDisplayNames({
      code,
      yahooName: q.name,
      nasdaqName: cleanNasdaqCompanyName(nq?.companyName),
      longName: cleanNasdaqCompanyName(nq?.companyName) || q.name,
    });
    return {
      code,
      name: names.name,
      nameEn: names.nameEn,
      nameZh: names.nameZh,
      close: round2(q.close),
      changePct: round2(q.changePct),
      dayAmt: round1(usdTurnoverToYi(dollar)),
      volume,
      volumeSource,
      _sort: dollar,
    };
  });

  enriched.sort((a, b) => b._sort - a._sort);
  const rows: UsTurnoverRow[] = enriched.slice(0, want).map((r, i) => ({
    rank: i + 1,
    code: r.code,
    name: r.name,
    nameEn: r.nameEn,
    nameZh: r.nameZh,
    close: r.close,
    changePct: r.changePct,
    dayAmt: r.dayAmt,
    volume: r.volume,
    volumeSource: r.volumeSource,
  }));

  const payload: UsTurnoverPayload = {
    date: ymdToIso(days[0]),
    ymd: days[0],
    rows,
    builtAt: new Date().toISOString(),
    source: "rebuilt",
    amountBasis: AMOUNT_BASIS,
    unit: "億美元",
    market: "us",
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
    const staleBasis =
      cached?.amountBasis && !cached.amountBasis.includes("Nasdaq");
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
