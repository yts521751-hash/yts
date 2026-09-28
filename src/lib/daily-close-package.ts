import "server-only";
import {
  artifactsComplete,
  isPackageUpToDate,
  resolveSyncTargetYmd,
  toCompactYmd,
} from "@/lib/gap-sync";
import {
  getLatestCachedTradingDay,
  invalidateTradingDaysMemo,
  readCacheFile,
  writeCacheFile,
} from "@/lib/tw-market";

/**
 * 日終大包（Daily Close Package）
 *
 * 設計原則（依產品建議）：
 * - 平日 18:00／18:30／19:00 一次向證交所／櫃買把「網站會用到的盤後資料」拉齊寫入 .cache
 * - 之後各頁（資金流、個股、產業 K、均線、風度）只讀這批快照，不再為了開頁去打交易所
 * - 成交排行改為日終快照（一般成交口徑），不再盤中即時輪詢
 * - 增量：先補水位之後缺日；若 active 大包已對齊最新交易日且 artifacts 齊則略過重算
 *
 * 快照仍拆成多個 cache 檔（較好增量更新／灰度），但由本模組統一編排與寫入 meta 索引。
 */

export const DAILY_CLOSE_META_CACHE = "daily-close-meta.json";

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
    klines: boolean;
    stocks: boolean;
    wind: boolean;
    ma: boolean;
    turnoverClose: boolean;
    valuePicks: boolean;
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

async function step<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<{ name: string; ok: boolean; detail?: string; ms: number; value?: T }> {
  const t0 = Date.now();
  try {
    const value = await fn();
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

/**
 * 執行日終大包：先缺口補日 →（可略過）flow 定稿與衍生快照。
 * 任一步失敗不阻断後續（meta 會標示），避免單一資料源拖垮整晚同步。
 */
export async function runDailyClosePackage(
  reason: string,
  options?: {
    /** 略過「已是最新」短路，強制重算衍生 */
    force?: boolean;
    /** 呼叫端已做過缺口補日時可跳過 */
    skipGapFill?: boolean;
  },
): Promise<DailyCloseMeta> {
  console.log(`[daily-close] start (${reason})`);
  await ensureHydrated();

  const steps: DailyCloseMeta["steps"] = [];
  let gapMeta: DailyCloseMeta["gap"];

  if (!options?.skipGapFill) {
    const gapStep = await step("gap-fill", async () => {
      const { fillTradingDayGaps } = await import("@/lib/turnover");
      const {
        beginRebuildProgress,
        setRebuildProgress,
        progressInRange,
      } = await import("@/lib/rebuild-progress");
      beginRebuildProgress("補缺交易日");
      return fillTradingDayGaps({
        onProgress: (p) => {
          const label =
            p.missingTotal > 0
              ? `補缺交易日 ${p.fetched}/${p.missingTotal}（已有略過 ${p.skipped}）`
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

  if (
    !options?.force &&
    latestQuote &&
    latestQuote >= target &&
    isPackageUpToDate(prevMeta, latestQuote)
  ) {
    const skippedMeta: DailyCloseMeta = {
      asOf: prevMeta!.asOf,
      builtAt: prevMeta!.builtAt,
      reason: `${reason}:skip-current`,
      steps: [
        ...steps,
        {
          name: "skip",
          ok: true,
          detail: `已是最新 asOf=${prevMeta!.asOf}，略過衍生重算`,
          ms: 0,
        },
      ],
      artifacts: prevMeta!.artifacts,
      skipped: true,
      gap: gapMeta,
    };
    await writeCacheFile(DAILY_CLOSE_META_CACHE, skippedMeta).catch(() => null);
    console.log(
      `[daily-close] skip (${reason}): package current asOf=${prevMeta!.asOf} ` +
        `gapFetched=${gapMeta?.fetched ?? 0}`,
    );
    return skippedMeta;
  }

  const artifacts: DailyCloseMeta["artifacts"] = {
    flow: false,
    quotesWarm: false,
    klines: false,
    stocks: false,
    wind: false,
    ma: false,
    turnoverClose: false,
    valuePicks: false,
  };
  let asOf: string | null = null;

  // 1) 資金流定稿（內含：近 N 日報價／法人、universe、staging→active、K 線預熱）
  const flowStep = await step("flow", async () => {
    const { rebuildFlowPayload } = await import("@/lib/build-flow");
    return rebuildFlowPayload({ promote: true });
  });
  steps.push({
    name: flowStep.name,
    ok: flowStep.ok,
    detail: flowStep.detail,
    ms: flowStep.ms,
  });
  if (flowStep.ok && flowStep.value) {
    artifacts.flow = true;
    artifacts.quotesWarm = true; // rebuild 內 ensureQuoteHistory
    artifacts.klines = true; // rebuild 內 warmSectorKlineCaches
    asOf = flowStep.value.brief?.date ?? null;
  }

  // 2) 個股資金流排行（只吃 .cache 報價／法人，force 重算後寫 flow-stocks-latest）
  const stocksStep = await step("stocks", async () => {
    const { buildStockFlowRanking } = await import("@/lib/stock-flow");
    return buildStockFlowRanking(50, { force: true });
  });
  steps.push({
    name: stocksStep.name,
    ok: stocksStep.ok,
    detail: stocksStep.detail,
    ms: stocksStep.ms,
  });
  artifacts.stocks = Boolean(stocksStep.ok && stocksStep.value?.rows?.length);

  // 3) 風度儀表（上市／上櫃指數均線結構）
  const windStep = await step("wind", async () => {
    const { computeWindPayload } = await import("@/lib/wind-gauge");
    return computeWindPayload({ force: true, allowNetwork: true });
  });
  steps.push({
    name: windStep.name,
    ok: windStep.ok,
    detail: windStep.detail,
    ms: windStep.ms,
  });
  artifacts.wind = Boolean(windStep.ok && windStep.value?.twse && windStep.value?.tpex);

  // 4) 產業均線掃描（依賴上一步 K 線快取）
  const maStep = await step("ma-screener", async () => {
    const { buildMaScreener } = await import("@/lib/ma-screener");
    return buildMaScreener({
      forceRebuildMissing: true,
      skipDiskCache: true,
    });
  });
  steps.push({
    name: maStep.name,
    ok: maStep.ok,
    detail: maStep.detail,
    ms: maStep.ms,
  });
  artifacts.ma = Boolean(maStep.ok && maStep.value?.rows?.length);

  // 5) 收盤版成交排行（一般成交口徑；日終寫快照，盤中不再即時抓）
  const turnoverStep = await step("turnover-close", async () => {
    const { buildTurnoverRanking } = await import("@/lib/turnover");
    return buildTurnoverRanking(50, { force: true });
  });
  steps.push({
    name: turnoverStep.name,
    ok: turnoverStep.ok,
    detail: turnoverStep.detail,
    ms: turnoverStep.ms,
  });
  artifacts.turnoverClose = Boolean(
    turnoverStep.ok && turnoverStep.value?.rows?.length,
  );

  // 6) 價值選股（法人 EPS 中位數 YoY＋前瞻本益比）
  const valueStep = await step("value-picks", async () => {
    const { buildValuePicks } = await import("@/lib/value-picks");
    return buildValuePicks({ force: true });
  });
  steps.push({
    name: valueStep.name,
    ok: valueStep.ok,
    detail: valueStep.detail,
    ms: valueStep.ms,
  });
  artifacts.valuePicks = Boolean(
    valueStep.ok && valueStep.value?.rows != null,
  );

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

  const okCount = steps.filter((s) => s.ok).length;
  console.log(
    `[daily-close] done (${reason}): ${okCount}/${steps.length} ok asOf=${asOf ?? "—"} ` +
      `complete=${artifactsComplete(artifacts)} target=${target} ` +
      `ms=${steps.map((s) => `${s.name}:${s.ms}`).join(",")}`,
  );
  return meta;
}

export async function readDailyCloseMeta(): Promise<DailyCloseMeta | null> {
  return readCacheFile<DailyCloseMeta>(DAILY_CLOSE_META_CACHE);
}

/** 背景單飛：開機補包／手動觸發用 */
export function requestDailyClosePackage(reason: string): {
  started: boolean;
  alreadyRunning: boolean;
} {
  const g = globalThis as typeof globalThis & {
    __jinliuDailyClose?: { running: boolean };
  };
  if (!g.__jinliuDailyClose) g.__jinliuDailyClose = { running: false };
  if (g.__jinliuDailyClose.running) {
    return { started: false, alreadyRunning: true };
  }
  g.__jinliuDailyClose.running = true;
  void runDailyClosePackage(reason)
    .catch((err) => {
      console.error(`[daily-close] background failed (${reason}):`, err);
    })
    .finally(() => {
      g.__jinliuDailyClose!.running = false;
    });
  return { started: true, alreadyRunning: false };
}

/** @deprecated 使用 gap-sync.toCompactYmd */
export function metaAsOfYmd(asOf: string | null | undefined): string | null {
  if (!asOf) return null;
  return toCompactYmd(asOf);
}
