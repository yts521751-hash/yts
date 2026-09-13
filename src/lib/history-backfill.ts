import "server-only";
import {
  beginRebuildProgress,
  finishRebuildProgress,
  progressInRange,
  setRebuildProgress,
} from "@/lib/rebuild-progress";
import {
  getCacheDir,
  HISTORY_TRADING_DAYS,
  listCachedTradingDays,
} from "@/lib/tw-market";

/**
 * 全量歷史補齊（與發佈無關，寫入 CACHE_DIR）：
 * 1) 報價日檔補到近約 60 個交易日（已有日檔會跳過）
 * 2) 跑日終大包（資金流、產業 K、個股、風度、均線掃描…）
 *
 * 之後每天同步只需補缺日／當日。
 */
export async function runHistoryBackfill(reason: string) {
  console.log(`[backfill] start (${reason}) cache=${getCacheDir()}`);
  beginRebuildProgress("補齊歷史報價");

  try {
    const { ensureQuoteHistory } = await import("@/lib/turnover");
    const before = await listCachedTradingDays(HISTORY_TRADING_DAYS);
    setRebuildProgress({
      percent: 5,
      label: `歷史報價 ${before.length}/${HISTORY_TRADING_DAYS}`,
    });

    await ensureQuoteHistory(HISTORY_TRADING_DAYS, {
      onProgress: (done, need) => {
        setRebuildProgress({
          percent: progressInRange(5, 40, done, need),
          label: `補齊歷史報價 ${done}/${need}`,
        });
      },
    });

    const after = await listCachedTradingDays(HISTORY_TRADING_DAYS);
    console.log(
      `[backfill] quotes: ${before.length} → ${after.length} (target ${HISTORY_TRADING_DAYS})`,
    );

    setRebuildProgress({ percent: 42, label: "日終大包（含產業 K／均線）" });
    const { runDailyClosePackage } = await import("@/lib/daily-close-package");
    const meta = await runDailyClosePackage(`backfill:${reason}`);

    const quoteDays = await listCachedTradingDays(HISTORY_TRADING_DAYS);
    finishRebuildProgress(true);
    console.log(
      `[backfill] done (${reason}) quoteDays=${quoteDays.length} asOf=${meta.asOf ?? "—"}`,
    );
    return { meta, quoteDays: quoteDays.length, target: HISTORY_TRADING_DAYS };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    finishRebuildProgress(false, message);
    throw err;
  }
}

function backfillBag() {
  const g = globalThis as typeof globalThis & {
    __jinliuHistoryBackfill?: { running: boolean };
  };
  if (!g.__jinliuHistoryBackfill) g.__jinliuHistoryBackfill = { running: false };
  return g.__jinliuHistoryBackfill;
}

/**
 * 前景同步（單飛）：同一請求內跑完，進度靠 rebuild-progress 訂閱推送。
 * 已在跑時回傳 alreadyRunning，呼叫端改訂閱現有進度即可。
 */
export async function runHistoryBackfillExclusive(reason: string): Promise<{
  alreadyRunning: boolean;
  result?: Awaited<ReturnType<typeof runHistoryBackfill>>;
}> {
  const bag = backfillBag();
  if (bag.running) {
    return { alreadyRunning: true };
  }
  bag.running = true;
  try {
    const result = await runHistoryBackfill(reason);
    return { alreadyRunning: false, result };
  } finally {
    bag.running = false;
  }
}

/** @deprecated 保留給空快取暖機；首頁改走 /api/sync 前景串流 */
export function requestHistoryBackfill(reason: string): {
  started: boolean;
  alreadyRunning: boolean;
} {
  const bag = backfillBag();
  if (bag.running) {
    return { started: false, alreadyRunning: true };
  }
  bag.running = true;
  beginRebuildProgress("補齊歷史報價");
  setTimeout(() => {
    void runHistoryBackfill(reason)
      .catch((err) => {
        console.error(`[backfill] failed (${reason}):`, err);
      })
      .finally(() => {
        bag.running = false;
      });
  }, 50);
  return { started: true, alreadyRunning: false };
}

export function isHistoryBackfillRunning(): boolean {
  return Boolean(backfillBag().running);
}
