/**
 * 價值選股：明年 EPS YoY（法人中位數）> 50%，前瞻本益比 < 35，
 * 且當日一般成交金額 ≥ 10 億。
 */

import { enrichStockFundamentals } from "@/lib/fundamentals";
import { applyRegularTurnover } from "@/lib/regular-turnover";
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
  /** 當日一般成交（億） */
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
    minDayAmtYi: number;
  };
};

const CACHE = "value-picks-latest.json";
const MIN_EPS_YOY = 50;
const MAX_FORWARD_PE = 35;
const MIN_DAY_AMT_YI = 10;
/** 取成交較熱的普通股當候選，兼顧涵蓋與抓取時間 */
const CANDIDATE_LIMIT = 300;

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
      // 舊快照若沒有成交門檻，視為失效
      if (
        Number.isFinite(age) &&
        age >= 0 &&
        age < 20 * 60 * 60 * 1000 &&
        cached.criteria?.minDayAmtYi === MIN_DAY_AMT_YI
      ) {
        return { ...cached, source: "cache" };
      }
    }
  }

  const days = await listCachedTradingDays(1, 40);
  const ymd = days[0];
  if (!ymd) return null;
  const quotes = await getCachedDayQuotes(ymd);
  if (!quotes?.size) return null;

  const regular = await applyRegularTurnover(quotes, ymd, {
    force: Boolean(options?.force),
  });

  const candidates = [...quotes.values()]
    .filter((q) => isCommonStock(q.code, q.name) && q.close > 0)
    .map((q) => ({
      q,
      dayAmtYi: (regular.get(q.code) ?? q.turnover) / 1e8,
    }))
    .filter((x) => x.dayAmtYi >= MIN_DAY_AMT_YI)
    .sort((a, b) => b.dayAmtYi - a.dayAmtYi)
    .slice(0, CANDIDATE_LIMIT);

  const fund = await enrichStockFundamentals(
    candidates.map((x) => x.q.code),
    { force: Boolean(options?.force) },
  );

  const rows: Omit<ValuePickRow, "rank">[] = [];
  for (const { q, dayAmtYi } of candidates) {
    const f = fund.get(q.code);
    if (!f) continue;
    const nextYearEps = f.nextYearEps;
    const baseEps = f.baseEps;
    const epsYoy = f.epsGrowth;
    if (
      nextYearEps == null ||
      nextYearEps <= 0 ||
      baseEps == null ||
      baseEps <= 0 ||
      epsYoy == null
    ) {
      continue;
    }
    if (epsYoy <= MIN_EPS_YOY) continue;
    const forwardPe = q.close / nextYearEps;
    if (
      !Number.isFinite(forwardPe) ||
      forwardPe <= 0 ||
      forwardPe >= MAX_FORWARD_PE
    ) {
      continue;
    }
    if (!f.epsSource?.startsWith("cnyes-factset-")) continue;

    rows.push({
      code: q.code,
      name: q.name.trim() || q.code,
      close: round2(q.close),
      changePct: round2(q.changePct),
      // 與成值頁相同：先存兩位再由 UI 固定一位小數顯示
      dayAmt: round2(dayAmtYi),
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
    criteria: {
      minEpsYoy: MIN_EPS_YOY,
      maxForwardPe: MAX_FORWARD_PE,
      minDayAmtYi: MIN_DAY_AMT_YI,
    },
  };
  await writeCacheFile(CACHE, payload);
  return payload;
}
