import { isCommonStock } from "@/lib/stock-filter";
import { applyRegularTurnover } from "@/lib/regular-turnover";
import {
  findMissingTradingDays,
  listWeekdaysBetween,
  resolveSyncTargetYmd,
  type GapFillProgress,
  type GapFillResult,
} from "@/lib/gap-sync";
import {
  listAllCachedQuoteYmds,
  listCachedTradingDays,
  listRecentTradingDays,
  getCachedDayQuotes,
  getLatestCachedTradingDay,
  loadMergedInstiDay,
  loadMergedQuotesDay,
  readCacheFile,
  writeCacheFile,
  ymdToIso,
  invalidateTradingDaysMemo,
  HISTORY_CALENDAR_LOOKBACK,
  HISTORY_TRADING_DAYS,
  type QuoteRow,
  type TradingDayProgressMeta,
} from "@/lib/tw-market";

export type TurnoverRow = {
  rank: number;
  code: string;
  name: string;
  turnoverYi: number;
  changePct: number;
  close: number;
  /** 前瞻本益比 = close / nextYearEps（有 EPS 才有） */
  forwardPe?: number | null;
  nextYearEps?: number | null;
  baseEps?: number | null;
  /** 明年 EPS YoY % */
  epsYoy?: number | null;
  epsSource?: string | null;
};

export type TurnoverPayload = {
  date: string;
  ymd: string;
  rows: TurnoverRow[];
  builtAt: string;
  source: "cache" | "rebuilt";
  total: number;
  /** 已不再做盤中即時；固定 false 以相容前端 */
  inSession: boolean;
  sessionNote: string;
  /** 成交口徑說明 */
  amountBasis: string;
};

const CACHE = "turnover-ranking-latest.json";
const round2 = (n: number) => Math.round(n * 100) / 100;

const AMOUNT_BASIS =
  "一般成交金額（上市／上櫃總成交 − 盤後定價 − 零股 − 鉅額；對齊 Yahoo／媒體常見口徑）";

const SESSION_NOTE =
  "每日收盤後隨日終大包更新（約 18:00／18:30／19:00），不做盤中即時輪詢";

async function rankDay(
  ymd: string,
  want: number,
  source: TurnoverPayload["source"],
  options?: { forceExclusions?: boolean },
): Promise<TurnoverPayload | null> {
  const map = await getCachedDayQuotes(ymd);
  if (!map?.size) return null;

  const regular = await applyRegularTurnover(map, ymd, {
    force: Boolean(options?.forceExclusions),
  });

  const rows = [...map.values()]
    .filter((q) => isCommonStock(q.code, q.name))
    .map((q) => ({
      q,
      turnover: regular.get(q.code) ?? q.turnover,
    }))
    .filter((x) => x.turnover > 0)
    .sort((a, b) => b.turnover - a.turnover)
    .slice(0, want)
    .map(({ q, turnover }, i) => ({
      rank: i + 1,
      code: q.code,
      name: q.name.trim(),
      turnoverYi: round2(turnover / 1e8),
      changePct: round2(q.changePct),
      close: round2(q.close),
    }));

  if (!rows.length) return null;

  return {
    date: ymdToIso(ymd),
    ymd,
    rows,
    builtAt: new Date().toISOString(),
    source,
    total: rows.length,
    inSession: false,
    sessionNote: SESSION_NOTE,
    amountBasis: AMOUNT_BASIS,
  };
}

/** 讀取日終成交排行快照；缺資料或 force 時重算並寫入 */
export async function buildTurnoverRanking(
  limit = 50,
  options?: { live?: boolean; force?: boolean },
): Promise<TurnoverPayload | null> {
  const want = Math.min(50, Math.max(1, limit));
  // live 參數保留相容，但不再做盤中即時抓取
  void options?.live;

  if (!options?.force) {
    const cached = await readCacheFile<TurnoverPayload>(CACHE);
    if (cached?.rows?.length) {
      const age = Date.now() - Date.parse(cached.builtAt || "");
      if (Number.isFinite(age) && age >= 0 && age < 36 * 60 * 60 * 1000) {
        return {
          ...cached,
          rows: cached.rows.slice(0, want),
          total: Math.min(cached.total, want),
          source: "cache",
          inSession: false,
          sessionNote: SESSION_NOTE,
          amountBasis: cached.amountBasis || AMOUNT_BASIS,
        };
      }
    }
  }

  const days = await listCachedTradingDays(1, 30);
  const ymd = days[0];
  if (!ymd) return null;

  const payload = await rankDay(ymd, want, "rebuilt", {
    forceExclusions: Boolean(options?.force),
  });
  if (!payload) return null;

  // 批次補基本面（共用 fundamentals 快取；不 force，避免 N+1 打爆）
  try {
    const { enrichStockFundamentals } = await import("@/lib/fundamentals");
    const fund = await enrichStockFundamentals(
      payload.rows.map((r) => r.code),
      { force: false },
    );
    for (const row of payload.rows) {
      const f = fund.get(row.code);
      if (!f) continue;
      row.nextYearEps = f.nextYearEps;
      row.baseEps = f.baseEps;
      row.epsYoy = f.epsGrowth;
      row.epsSource = f.epsSource;
      if (
        f.nextYearEps != null &&
        f.nextYearEps > 0 &&
        Number.isFinite(row.close)
      ) {
        row.forwardPe = round2(row.close / f.nextYearEps);
      } else {
        row.forwardPe = null;
      }
    }
  } catch (err) {
    console.warn("[turnover] fundamentals enrich failed", err);
  }

  await writeCacheFile(CACHE, payload);
  return payload;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 只補「水位之後 → 同步目標日」的缺日報價／法人；已有日檔略過。
 * 若歷史深度不足 HISTORY_TRADING_DAYS，再往回補到目標根數（仍跳過已存在檔）。
 */
export async function fillTradingDayGaps(options?: {
  needDays?: number;
  onProgress?: (p: GapFillProgress) => void;
}): Promise<GapFillResult> {
  const needDays = options?.needDays ?? HISTORY_TRADING_DAYS;
  const lookback = Math.max(
    HISTORY_CALENDAR_LOOKBACK,
    Math.ceil(needDays * 2.2),
  );
  const target = resolveSyncTargetYmd();
  const existing = await listAllCachedQuoteYmds();
  const existingSet = new Set(existing);
  const watermark = existing[0] ?? null;

  // 水位之後的缺日（含目標日）；無水位則先不列全窗，交給深度回補
  const afterWatermark = watermark
    ? listWeekdaysBetween(watermark, target, needDays + 10)
    : listWeekdaysBetween(null, target, needDays);
  const missing = findMissingTradingDays(existingSet, afterWatermark);

  // skipped = 本次略過的缺日數（非本機全部日檔數）
  options?.onProgress?.({
    done: 0,
    need: Math.max(missing.length, 1),
    skipped: 0,
    fetched: 0,
    missingTotal: missing.length,
    phase: missing.length ? "fetch" : "scan",
  });

  let fetched = 0;
  const fetchedYmds: string[] = [];
  for (let i = 0; i < missing.length; i++) {
    const ymd = missing[i];
    options?.onProgress?.({
      done: i,
      need: missing.length,
      skipped: i - fetched,
      fetched,
      missingTotal: missing.length,
      currentYmd: ymd,
      phase: "fetch",
    });
    const quotes = await loadMergedQuotesDay(ymd);
    if (quotes?.quotes?.length) {
      fetched++;
      fetchedYmds.push(ymd);
      existingSet.add(ymd);
      await loadMergedInstiDay(ymd);
      await sleep(180);
    } else {
      await sleep(120);
    }
  }

  // 深度不足：往回補（listRecentTradingDays 會跳過已有檔）。
  // 水位已到目標就不為「幽靈休市目標」再掃 60 日；缺日全打空（休市）也不再追。
  let quoteDays = await listCachedTradingDays(needDays, lookback);
  let depthFetched = 0;
  let depthSkipped = 0;
  const watermarkNow = quoteDays[0] ?? watermark;
  const doDepth =
    quoteDays.length < needDays ||
    (watermarkNow != null && watermarkNow < target && fetched > 0);
  if (doDepth) {
    quoteDays = await listRecentTradingDays(needDays, lookback, {
      onProgress: (done, need, meta?: TradingDayProgressMeta) => {
        depthSkipped = meta?.skipped ?? depthSkipped;
        depthFetched = meta?.fetched ?? depthFetched;
        options?.onProgress?.({
          done,
          need,
          skipped: depthSkipped,
          fetched: fetched + depthFetched,
          // 深度回補用獨立 phase，避免 UI 把「補缺 1 日」顯示成 X/60
          missingTotal: need,
          currentYmd: meta?.currentYmd,
          phase: "depth",
        });
      },
    });
  } else if (watermarkNow != null && watermarkNow < target && missing.length > 0) {
    // 目標日無報價（休市／未公布）：以現有水位為準，只在根數不足時才深度回補
    console.warn(
      `[gap-fill] target ${target} unreachable (watermark=${watermarkNow}, ` +
        `missingTried=${missing.length}, fetched=0); skip depth chase`,
    );
  }

  // 只為「本次新抓到的日」確保法人檔（已有檔略過）；不再每次掃 25 日
  quoteDays = await listCachedTradingDays(needDays, lookback);
  for (const ymd of [...new Set(fetchedYmds)]) {
    await loadMergedInstiDay(ymd);
  }

  const totalFetched = fetched + depthFetched;
  if (totalFetched > 0) invalidateTradingDaysMemo();
  quoteDays = await listCachedTradingDays(needDays, lookback);
  const skippedThisRun = Math.max(0, missing.length - fetched) + depthSkipped;

  options?.onProgress?.({
    done: Math.max(missing.length, quoteDays.length),
    need: Math.max(missing.length, 1),
    skipped: skippedThisRun,
    fetched: totalFetched,
    missingTotal: missing.length,
    phase: "done",
  });

  return {
    watermark,
    target,
    missing,
    fetched: totalFetched,
    skipped: skippedThisRun,
    quoteDays,
    didFetch: totalFetched > 0,
  };
}

/**
 * 補齊報價日檔到近約 60 個交易日，且水位必須涵蓋同步目標日。
 * 已有 ≥60 檔但最新日落後時仍會只補缺口（不再 early-exit）。
 */
export async function ensureQuoteHistory(
  needDays = HISTORY_TRADING_DAYS,
  options?: {
    onProgress?: (
      done: number,
      need: number,
      meta?: TradingDayProgressMeta,
    ) => void;
  },
) {
  const result = await fillTradingDayGaps({
    needDays,
    onProgress: (p) => {
      options?.onProgress?.(p.done, p.need, {
        skipped: p.skipped,
        fetched: p.fetched,
        missingTotal: p.missingTotal,
        currentYmd: p.currentYmd,
      });
    },
  });
  return result.quoteDays;
}

/** 目前報價水位（最新 quotes 日） */
export async function getQuoteWatermark(): Promise<string | null> {
  return getLatestCachedTradingDay();
}

export type { QuoteRow, GapFillResult, GapFillProgress };
