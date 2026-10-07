import "server-only";
import {
  artifactsComplete,
  isMetaAsOfTarget,
  isPackageUpToDate,
  resolveSyncTargetYmd,
  shouldUseLightDailyClose,
  toCompactYmd,
} from "@/lib/gap-sync";
import {
  getLatestCachedTradingDay,
  invalidateTradingDaysMemo,
  readCacheFile,
  writeCacheFile,
} from "@/lib/tw-market";
import {
  setRebuildProgress,
  progressInRange,
} from "@/lib/rebuild-progress";

/**
 * 日終大包（Daily Close Package）
 *
 * 設計原則（依產品建議）：
 * - 平日 18:00／18:30／19:00 一次向證交所／櫃買把「網站會用到的盤後資料」拉齊寫入 .cache
 * - 之後各頁（資金流、個股、均線、風度、產業流）只讀這批快照，不再為了開頁去打交易所
 * - 成交排行改為日終快照（一般成交口徑），不再盤中即時輪詢
 * - 增量：先補水位之後缺日；若 active 大包已對齊最新交易日且 artifacts 齊則略過重算
 * - 報價水位已到目標 → 一律輕量路徑（本機日檔）；避免全量 exclusions／fundamentals 拖垮手動同步
 * - 各步驟有超時；非核心失敗不阻斷整包
 * - 台股產業 K 線頁已下線：同步不再暖全產業 K（artifacts.klines 固定標齊）
 *
 * 快照仍拆成多個 cache 檔（較好增量更新／灰度），但由本模組統一編排與寫入 meta 索引。
 */

export const DAILY_CLOSE_META_CACHE = "daily-close-meta.json";

/** 單步預設超時（ms）；逾時標失敗並繼續，避免整包卡死 */
const STEP_TIMEOUT_MS: Record<string, number> = {
  "gap-fill": 180_000,
  flow: 90_000,
  stocks: 120_000,
  wind: 60_000,
  "ma-screener": 120_000,
  "turnover-close": 90_000,
  "value-picks": 180_000,
  "industry-flow": 90_000,
};
const DEFAULT_STEP_TIMEOUT_MS = 120_000;

export type DailyCloseMeta = {
  /** 資料所屬交易日 YYYY-MM-DD */
  asOf: string | null;
  builtAt: string;
  reason: string;
  steps: Array<{
    name: string;
    ok: boolean;
    detail?: string;
    ms: number;
  }>;
  artifacts: {
    flow: boolean;
    quotesWarm: boolean;
    klines: boolean; // 保留欄位；產業 K 頁已下線，寫入時固定 true
    stocks: boolean;
    wind: boolean;
    ma: boolean;
    turnoverClose: boolean;
    valuePicks: boolean;
    industryFlow: boolean;
  };
  /** 本次是否略過衍生重算（已是最新） */
  skipped?: boolean;
  gap?: {
    watermark: string | null;
    target: string;
    missing: number;
    fetched: number;
    skippedExisting: number;
  };
};

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function step<T>(
  name: string,
  fn: () => Promise<T>,
  timeoutMs = STEP_TIMEOUT_MS[name] ?? DEFAULT_STEP_TIMEOUT_MS,
): Promise<{ name: string; ok: boolean; detail?: string; ms: number; value?: T }> {
  const t0 = Date.now();
  try {
    const value = await withTimeout(fn(), timeoutMs, name);
    return { name, ok: true, ms: Date.now() - t0, value };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[daily-close] ${name} failed:`, detail);
    return { name, ok: false, detail, ms: Date.now() - t0 };
  }
}

async function ensureHydrated() {
  try {
    const { getCacheDir } = await import("@/lib/tw-market");
    const { hydrateCacheFromR2, isR2Enabled } = await import("@/lib/r2-cache");
    if (isR2Enabled()) {
      await hydrateCacheFromR2(getCacheDir());
      invalidateTradingDaysMemo();
    }
  } catch (err) {
    console.warn("[daily-close] r2 hydrate skipped:", err);
  }
}

function dailyCloseBag() {
  const g = globalThis as typeof globalThis & {
    __jinliuDailyClose?: {
      running: boolean;
      /** 單飛佇列：boot 暖機與手動 sync 共用，避免並行重算 */
      tail: Promise<unknown>;
      /** 進行中的 Promise；後續呼叫可 join，避免排隊卡在「檢查日終大包」 */
      current: Promise<DailyCloseMeta> | null;
    };
  };
  if (!g.__jinliuDailyClose) {
    g.__jinliuDailyClose = {
      running: false,
      tail: Promise.resolve(),
      current: null,
    };
  }
  return g.__jinliuDailyClose;
}

function markStep(
  label: string,
  from: number,
  to: number,
  index: number,
  total: number,
) {
  setRebuildProgress({
    percent: progressInRange(from, to, index, total),
    label,
  });
}

/**
 * 執行日終大包：先缺口補日 →（可略過）flow 定稿與衍生快照。
 * 任一步失敗不阻断後續（meta 會標示），避免單一資料源拖垮整晚同步。
 * 與 requestDailyClosePackage／手動 sync 共用單飛；已在跑時 join 同一 Promise。
 */
export async function runDailyClosePackage(
  reason: string,
  options?: {
    /** 略過「已是最新」短路，強制重算衍生 */
    force?: boolean;
    /** 呼叫端已做過缺口補日時可跳過 */
    skipGapFill?: boolean;
    /** 小缺口提示：略過二次歷史回補／用本機日檔 */
    smallGap?: boolean;
  },
): Promise<DailyCloseMeta> {
  const bag = dailyCloseBag();
  // 非 force：加入進行中的那次，避免 boot＋手動同步串成雙倍重活、進度卡死
  if (bag.current && !options?.force) {
    console.log(`[daily-close] join in-flight (${reason})`);
    setRebuildProgress({
      label: "等待進行中的日終同步…",
    });
    const JOIN_MS = 180_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        bag.current,
        new Promise<DailyCloseMeta>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error(`join timed out after ${JOIN_MS}ms`)),
            JOIN_MS,
          );
        }),
      ]);
    } catch (err) {
      // 殭屍 in-flight：丟棄後重跑，避免使用者永遠卡在近 100%
      console.warn(
        `[daily-close] join abandoned (${reason}), rerun:`,
        err instanceof Error ? err.message : err,
      );
      bag.current = null;
      bag.running = false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const run = () => {
    const p = runDailyClosePackageUnlocked(reason, options);
    bag.current = p;
    return p.finally(() => {
      if (bag.current === p) bag.current = null;
    });
  };
  const next = bag.tail.then(run, run);
  bag.tail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export function isDailyCloseRunning(): boolean {
  return Boolean(dailyCloseBag().current || dailyCloseBag().running);
}

async function runDailyClosePackageUnlocked(
  reason: string,
  options?: {
    force?: boolean;
    skipGapFill?: boolean;
    smallGap?: boolean;
  },
): Promise<DailyCloseMeta> {
  console.log(`[daily-close] start (${reason})`);
  await ensureHydrated();

  const steps: DailyCloseMeta["steps"] = [];
  let gapMeta: DailyCloseMeta["gap"];

  if (!options?.skipGapFill) {
    const gapStep = await step("gap-fill", async () => {
      const { fillTradingDayGaps } = await import("@/lib/turnover");
      const { beginRebuildProgress } = await import("@/lib/rebuild-progress");
      beginRebuildProgress("補缺交易日");
      return fillTradingDayGaps({
        onProgress: (p) => {
          const label =
            p.phase === "depth"
              ? `深度回補交易日 ${p.done}/${p.need}（略過 ${p.skipped}）`
              : p.missingTotal > 0
                ? `補缺交易日 ${p.fetched}/${p.missingTotal}（略過 ${p.skipped}）`
                : p.phase === "done"
                  ? `交易日已齊（略過 ${p.skipped}）`
                  : `檢查交易日缺口（已有 ${p.skipped}）`;
          setRebuildProgress({
            percent: progressInRange(3, 38, p.done, Math.max(p.need, 1)),
            label,
          });
        },
      });
    });
    steps.push({
      name: gapStep.name,
      ok: gapStep.ok,
      detail: gapStep.detail,
      ms: gapStep.ms,
    });
    if (gapStep.ok && gapStep.value) {
      gapMeta = {
        watermark: gapStep.value.watermark,
        target: gapStep.value.target,
        missing: gapStep.value.missing.length,
        fetched: gapStep.value.fetched,
        skippedExisting: gapStep.value.skipped,
      };
    }
  }

  const latestQuote = await getLatestCachedTradingDay();
  const prevMeta = await readDailyCloseMeta();
  const target = resolveSyncTargetYmd();
  const metaMatchesTarget = isMetaAsOfTarget(prevMeta, target);
  const packageCurrent =
    Boolean(latestQuote) &&
    latestQuote! >= target &&
    isPackageUpToDate(prevMeta, latestQuote);

  // asOf＝目標交易日，或水位＋artifacts 已齊 → 略過衍生重算（含交易所）
  if (!options?.force && prevMeta && (metaMatchesTarget || packageCurrent)) {
    const skippedMeta: DailyCloseMeta = {
      asOf: prevMeta.asOf,
      builtAt: prevMeta.builtAt,
      reason: `${reason}:skip-current`,
      steps: [
        ...steps,
        {
          name: "skip",
          ok: true,
          detail: `已是最新 asOf=${prevMeta.asOf} target=${target}，略過衍生重算`,
          ms: 0,
        },
      ],
      artifacts: prevMeta.artifacts,
      skipped: true,
      gap: gapMeta,
    };
    await writeCacheFile(DAILY_CLOSE_META_CACHE, skippedMeta).catch(() => null);
    await flushUploadsSafe();
    console.log(
      `[daily-close] skip (${reason}): package current asOf=${prevMeta.asOf} ` +
        `target=${target} gapFetched=${gapMeta?.fetched ?? 0}`,
    );
    return skippedMeta;
  }

  // 小缺口／報價已齊：走輕量路徑（本機日檔）。舊 meta 缺 industryFlow 時
  // 不可再卡進「全量 exclusions＋fundamentals」重路徑，否則手動同步必逾時。
  const preferLight =
    Boolean(options?.smallGap) ||
    Boolean(options?.skipGapFill) ||
    (gapMeta?.fetched ?? 0) <= 3;
  const useLight = shouldUseLightDailyClose({
    force: options?.force,
    latestQuoteYmd: latestQuote,
    targetYmd: target,
    preferLight,
  });
  // 保留變數名 smallGap 給後續分支／log（語意＝輕量路徑）
  const smallGap = useLight;

  const artifacts: DailyCloseMeta["artifacts"] = {
    flow: false,
    quotesWarm: false,
    klines: false,
    stocks: false,
    wind: false,
    ma: false,
    turnoverClose: false,
    valuePicks: false,
    industryFlow: false,
  };
  let asOf: string | null = null;

  // —— 輕量路徑：quotes+insti 已齊 → flow（本機）→ 並行衍生；均線開頁再補
  if (smallGap && !options?.force) {
    markStep("輕量日終：資金流（本機日檔）", 42, 55, 0, 2);
    const flowStep = await step("flow", async () => {
      const { rebuildFlowPayload } = await import("@/lib/build-flow");
      return rebuildFlowPayload({
        promote: true,
        cacheOnly: true,
        skipEnsureHistory: true,
        skipKlineWarm: true,
        manageProgress: false,
      });
    });
    steps.push({
      name: flowStep.name,
      ok: flowStep.ok,
      detail: flowStep.detail ?? "tiny-gap:cacheOnly+skipKlineWarm",
      ms: flowStep.ms,
    });
    if (flowStep.ok && flowStep.value) {
      artifacts.flow = true;
      artifacts.quotesWarm = true;
      artifacts.klines = true;
      asOf = flowStep.value.brief?.date ?? null;
    }

    markStep("輕量日終：並行更新衍生", 55, 96, 1, 2);
    const parallelT0 = Date.now();
    const [stocksStep, windStep, turnoverStep, valueStep, industryStep] =
      await Promise.all([
      step("stocks", async () => {
        const { listCachedTradingDays } = await import("@/lib/tw-market");
        const { warmTurnoverExclusions } = await import(
          "@/lib/regular-turnover"
        );
        const { buildStockFlowRanking } = await import("@/lib/stock-flow");
        const days = await listCachedTradingDays(25, 60);
        if (days.length) {
          await warmTurnoverExclusions(days.slice(0, 1), {
            forceLatest: days[0],
            concurrency: 4,
          });
        }
        return buildStockFlowRanking(50, {
          force: true,
          forceFundamentals: false,
          skipWarmExclusions: true,
        });
      }),
      step("wind", async () => {
        const { computeWindPayload } = await import("@/lib/wind-gauge");
        // 小缺口：允許用較新快取，避免無謂重打指數源
        return computeWindPayload({ force: false, allowNetwork: true });
      }),
      step("turnover-close", async () => {
        const { buildTurnoverRanking } = await import("@/lib/turnover");
        return buildTurnoverRanking(50, { force: true });
      }),
      step("value-picks", async () => {
        const { buildValuePicks } = await import("@/lib/value-picks");
        // 沿用 EPS 快取；不強制重抓數百檔
        return buildValuePicks({ force: false });
      }),
      step("industry-flow", async () => {
        const { rebuildIndustryFlowPayload } = await import(
          "@/lib/build-industry-flow"
        );
        return rebuildIndustryFlowPayload({ cacheOnly: true });
      }),
    ]);

    const parallelMs = Date.now() - parallelT0;
    for (const s of [
      stocksStep,
      windStep,
      turnoverStep,
      valueStep,
      industryStep,
    ]) {
      steps.push({
        name: s.name,
        ok: s.ok,
        detail: s.detail,
        ms: s.ms,
      });
    }
    steps.push({
      name: "parallel-bundle",
      ok: true,
      detail: `stocks+wind+turnover+value+industryFlow wall=${parallelMs}ms`,
      ms: parallelMs,
    });

    artifacts.stocks = Boolean(stocksStep.ok && stocksStep.value?.rows?.length);
    artifacts.wind = Boolean(
      windStep.ok && windStep.value?.twse && windStep.value?.tpex,
    );
    // 小缺口略過 ma 全掃；標齊以免卡住 packageUpToDate（開頁／背景再補）
    artifacts.ma = true;
    steps.push({
      name: "ma-screener",
      ok: true,
      detail: "light:skipped（沿用快取／開頁再補）",
      ms: 0,
    });
    artifacts.klines = true;
    artifacts.turnoverClose = Boolean(
      turnoverStep.ok && turnoverStep.value?.rows?.length,
    );
    artifacts.valuePicks = Boolean(
      valueStep.ok && valueStep.value?.rows != null,
    );
    artifacts.industryFlow = Boolean(
      industryStep.ok && industryStep.value?.rows?.length,
    );

    // 背景暖機券商目標價（不阻塞日終）
    try {
      const { warmBrokerTargetsFromUniverse } = await import(
        "@/lib/broker-targets"
      );
      warmBrokerTargetsFromUniverse(`${reason}:tiny-gap`);
    } catch (err) {
      console.warn("[daily-close] broker-targets warm skip", err);
    }

    const meta: DailyCloseMeta = {
      asOf,
      builtAt: new Date().toISOString(),
      reason: `${reason}:tiny-gap`,
      steps,
      artifacts,
      skipped: false,
      gap: gapMeta,
    };
    await writeCacheFile(DAILY_CLOSE_META_CACHE, meta).catch(() => null);
    await flushUploadsSafe();

    const okCount = steps.filter((s) => s.ok).length;
    console.log(
      `[daily-close] done (${reason}:tiny-gap): ${okCount}/${steps.length} ok asOf=${asOf ?? "—"} ` +
        `complete=${artifactsComplete(artifacts)} target=${target} ` +
        `ms=${steps.map((s) => `${s.name}:${s.ms}`).join(",")}`,
    );
    return meta;
  }

  // —— 重路徑：報價未齊或 force。仍限縮 I/O，並靠 step timeout 保底。
  const totalSteps = 6;

  // 1) 資金流定稿
  markStep("重算資金流", 42, 52, 0, totalSteps);
  const flowStep = await step("flow", async () => {
    const { rebuildFlowPayload } = await import("@/lib/build-flow");
    return rebuildFlowPayload({
      promote: true,
      cacheOnly: Boolean(options?.skipGapFill),
      skipEnsureHistory: Boolean(options?.skipGapFill),
      skipKlineWarm: true,
      manageProgress: false,
    });
  });
  steps.push({
    name: flowStep.name,
    ok: flowStep.ok,
    detail: flowStep.detail,
    ms: flowStep.ms,
  });
  if (flowStep.ok && flowStep.value) {
    artifacts.flow = true;
    artifacts.quotesWarm = true;
    artifacts.klines = true;
    asOf = flowStep.value.brief?.date ?? null;
  }

  markStep("更新個股金流／風度／均線／成交／價值", 52, 98, 1, totalSteps);

  const stocksStep = await step("stocks", async () => {
    const { listCachedTradingDays } = await import("@/lib/tw-market");
    const { warmTurnoverExclusions } = await import("@/lib/regular-turnover");
    const { buildStockFlowRanking } = await import("@/lib/stock-flow");
    const days = await listCachedTradingDays(25, 60);
    if (days.length) {
      // 只暖最新一日；全量 25 日 exclusions 曾拖垮同步
      await warmTurnoverExclusions(days.slice(0, 1), {
        forceLatest: days[0],
        concurrency: 4,
      });
    }
    const payload = await buildStockFlowRanking(50, {
      force: true,
      forceFundamentals: false,
      skipWarmExclusions: true,
    });
    await flushUploadsSafe();
    return payload;
  });
  steps.push({
    name: stocksStep.name,
    ok: stocksStep.ok,
    detail: stocksStep.detail,
    ms: stocksStep.ms,
  });
  artifacts.stocks = Boolean(stocksStep.ok && stocksStep.value?.rows?.length);

  // wind / ma / turnover / value / industry-flow 互不依賴 → 並行
  const [windStep, maStep, turnoverStep, valueStep, industryStep] =
    await Promise.all([
    step("wind", async () => {
      const { computeWindPayload } = await import("@/lib/wind-gauge");
      return computeWindPayload({ force: true, allowNetwork: true });
    }),
    step("ma-screener", async () => {
      const { buildMaScreener } = await import("@/lib/ma-screener");
      return buildMaScreener({
        forceRebuildMissing: false,
        skipDiskCache: false,
        skipEnsureHistory: true,
      });
    }),
    step("turnover-close", async () => {
      const { buildTurnoverRanking } = await import("@/lib/turnover");
      return buildTurnoverRanking(50, { force: true });
    }),
    step("value-picks", async () => {
      const { buildValuePicks } = await import("@/lib/value-picks");
      // ymd 對齊最新 quotes；不強制重抓數百檔 EPS
      return buildValuePicks({ force: false });
    }),
    step("industry-flow", async () => {
      const { rebuildIndustryFlowPayload } = await import(
        "@/lib/build-industry-flow"
      );
      return rebuildIndustryFlowPayload({ cacheOnly: true });
    }),
  ]);

  for (const s of [windStep, maStep, turnoverStep, valueStep, industryStep]) {
    steps.push({
      name: s.name,
      ok: s.ok,
      detail: s.detail,
      ms: s.ms,
    });
  }
  artifacts.wind = Boolean(
    windStep.ok && windStep.value?.twse && windStep.value?.tpex,
  );
  artifacts.ma = true; // 均線可開頁再補；不阻擋 packageUpToDate
  if (maStep.ok && maStep.value?.rows?.length) {
    artifacts.ma = true;
  }
  artifacts.turnoverClose = Boolean(
    turnoverStep.ok && turnoverStep.value?.rows?.length,
  );
  artifacts.valuePicks = Boolean(
    valueStep.ok && valueStep.value?.rows != null,
  );
  artifacts.industryFlow = Boolean(
    industryStep.ok && industryStep.value?.rows?.length,
  );
  artifacts.klines = true;

  try {
    const { warmBrokerTargetsFromUniverse } = await import(
      "@/lib/broker-targets"
    );
    warmBrokerTargetsFromUniverse(reason);
  } catch (err) {
    console.warn("[daily-close] broker-targets warm skip", err);
  }

  const meta: DailyCloseMeta = {
    asOf,
    builtAt: new Date().toISOString(),
    reason,
    steps,
    artifacts,
    skipped: false,
    gap: gapMeta,
  };
  await writeCacheFile(DAILY_CLOSE_META_CACHE, meta).catch(() => null);
  await flushUploadsSafe();

  const okCount = steps.filter((s) => s.ok).length;
  console.log(
    `[daily-close] done (${reason}): ${okCount}/${steps.length} ok asOf=${asOf ?? "—"} ` +
      `complete=${artifactsComplete(artifacts)} target=${target} light=${smallGap} ` +
      `ms=${steps.map((s) => `${s.name}:${s.ms}`).join(",")}`,
  );
  return meta;
}

async function flushUploadsSafe() {
  try {
    const { flushCacheSideEffects } = await import("@/lib/tw-market");
    const flush = await flushCacheSideEffects({ timeoutMs: 8_000 });
    console.log(
      `[daily-close] cache side-effects flushed timedOut=${flush.timedOut}`,
    );
  } catch (err) {
    console.warn("[daily-close] r2 flush:", err);
  }
}

export async function readDailyCloseMeta(): Promise<DailyCloseMeta | null> {
  return readCacheFile<DailyCloseMeta>(DAILY_CLOSE_META_CACHE);
}

/** 背景單飛：開機補包／手動觸發用 */
export function requestDailyClosePackage(reason: string): {
  started: boolean;
  alreadyRunning: boolean;
} {
  const bag = dailyCloseBag();
  if (bag.running) {
    return { started: false, alreadyRunning: true };
  }
  bag.running = true;
  void runDailyClosePackage(reason)
    .catch((err) => {
      console.error(`[daily-close] background failed (${reason}):`, err);
    })
    .finally(() => {
      bag.running = false;
    });
  return { started: true, alreadyRunning: false };
}

/** @deprecated 使用 gap-sync.toCompactYmd */
export function metaAsOfYmd(asOf: string | null | undefined): string | null {
  if (!asOf) return null;
  return toCompactYmd(asOf);
}
