/**
 * 價值選股：明年 EPS YoY（法人中位數）> 50%，且前瞻本益比 < 35。
 * 前瞻本益比 = 股價 ÷ 明年 EPS 中位數。
 */

import { enrichStockFundamentals } from "@/lib/fundamentals";
import { isCommonStock } from "@/lib/stock-filter";
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
  close: number;
  changePct: number;
  /** 當日成交（億） */
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
  };
};

const CACHE = "value-picks-latest.json";
const MIN_EPS_YOY = 50;
const MAX_FORWARD_PE = 35;
/** 取成交較熱的普通股當候選，兼顧涵蓋與抓取時間 */
const CANDIDATE_LIMIT = 400;

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

export async function readValuePicksCache(): Promise<ValuePicksPayload | null> {
  return readCacheFile<ValuePicksPayload>(CACHE);
}

export async function buildValuePicks(options?: {
  force?: boolean;
}): Promise<ValuePicksPayload | null> {
  if (!options?.force) {
    const cached = await readValuePicksCache();
    if (cached?.rows && cached.builtAt) {
      const age = Date.now() - Date.parse(cached.builtAt);
      if (Number.isFinite(age) && age >= 0 && age < 20 * 60 * 60 * 1000) {
        return { ...cached, source: "cache" };
      }
    }
  }

  const days = await listCachedTradingDays(1, 40);
  const ymd = days[0];
  if (!ymd) return null;
  const quotes = await getCachedDayQuotes(ymd);
  if (!quotes?.size) return null;

  const candidates = [...quotes.values()]
    .filter((q) => isCommonStock(q.code, q.name) && q.close > 0 && q.turnover > 0)
    .sort((a, b) => b.turnover - a.turnover)
    .slice(0, CANDIDATE_LIMIT);

  const fund = await enrichStockFundamentals(
    candidates.map((q) => q.code),
    { force: Boolean(options?.force) },
  );

  const rows: Omit<ValuePickRow, "rank">[] = [];
  for (const q of candidates) {
    const f = fund.get(q.code);
    if (!f) continue;
    const nextYearEps = f.nextYearEps;
    const baseEps = f.baseEps;
    const epsYoy = f.epsGrowth;
    if (
      nextYearEps == null ||
      nextYearEps <= 0 ||
      baseEps == null ||
      baseEps === 0 ||
      epsYoy == null
    ) {
      continue;
    }
    if (epsYoy <= MIN_EPS_YOY) continue;
    const forwardPe = q.close / nextYearEps;
    if (!Number.isFinite(forwardPe) || forwardPe <= 0 || forwardPe >= MAX_FORWARD_PE) {
      continue;
    }
    // 只要法人共識（中位數優先；缺中位數時 mean 後援）；排除 Yahoo／財報推估
    if (!f.epsSource?.startsWith("cnyes-factset-")) continue;

    rows.push({
      code: q.code,
      name: q.name.trim() || q.code,
      close: round2(q.close),
      changePct: round2(q.changePct),
      dayAmt: round1(q.turnover / 1e8),
      nextYearEps: round2(nextYearEps),
      baseEps: round2(baseEps),
      epsYoy: round1(epsYoy),
      forwardPe: round2(forwardPe),
      epsSource: f.epsSource,
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
    criteria: { minEpsYoy: MIN_EPS_YOY, maxForwardPe: MAX_FORWARD_PE },
  };
  await writeCacheFile(CACHE, payload);
  return payload;
}
