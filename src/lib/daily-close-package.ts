import "server-only";
import { readCacheFile, writeCacheFile } from "@/lib/tw-market";

/**
 * 日終大包（Daily Close Package）
 *
 * 設計原則（依產品建議）：
 * - 平日 18:00／18:30／19:00 一次向證交所／櫃買把「網站會用到的盤後資料」拉齊寫入 .cache
 * - 之後各頁（資金流、個股、產業 K、均線、風度）只讀這批快照，不再為了開頁去打交易所
 * - 盤中唯一需要即時拉的是「成交金額排行」（turnover live）；其餘等日終同步
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

/**
 * 執行日終大包：flow 定稿 → 報價／K 線已在 flow 內預熱 → 個股／風度／均線／收盤成交排行。
 * 任一步失敗不阻断後續（meta 會標示），避免單一資料源拖垮整晚同步。
 */
export async function runDailyClosePackage(reason: string): Promise<DailyCloseMeta> {
  console.log(`[daily-close] start (${reason})`);

  const steps: DailyCloseMeta["steps"] = [];
  const artifacts: DailyCloseMeta["artifacts"] = {
    flow: false,
    quotesWarm: false,
    klines: false,
    stocks: false,
    wind: false,
    ma: false,
    turnoverClose: false,
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

  // 5) 收盤版成交排行（非 live；盤中 live 仍走 /api/turnover?live=1）
  const turnoverStep = await step("turnover-close", async () => {
    const { buildTurnoverRanking } = await import("@/lib/turnover");
    return buildTurnoverRanking(50, { live: false });
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

  const meta: DailyCloseMeta = {
    asOf,
    builtAt: new Date().toISOString(),
    reason,
    steps,
    artifacts,
  };
  await writeCacheFile(DAILY_CLOSE_META_CACHE, meta).catch(() => null);

  const okCount = steps.filter((s) => s.ok).length;
  console.log(
    `[daily-close] done (${reason}): ${okCount}/${steps.length} ok asOf=${asOf ?? "—"} ` +
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
