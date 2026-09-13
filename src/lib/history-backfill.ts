import "server-only";
import {
  beginRebuildProgress,
  finishRebuildProgress,
  getRebuildProgress,
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
 * 1) 報價日檔補到可畫季線（預設 120 交易日；已有日檔會跳過）
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

/** 背景單飛：首頁「觸發背景更新」／手動補歷史用 */
export function requestHistoryBackfill(reason: string): {
  started: boolean;
  alreadyRunning: boolean;
} {
  const g = globalThis as typeof globalThis & {
    __jinliuHistoryBackfill?: { running: boolean };
  };
  if (!g.__jinliuHistoryBackfill) g.__jinliuHistoryBackfill = { running: false };
  if (g.__jinliuHistoryBackfill.running) {
    // 已在跑：確保進度仍為 active，讓輪詢／按鈕能繼續顯示
    const cur = getRebuildProgress();
    if (!cur.active) {
      beginRebuildProgress("同步進行中");
    } else {
      setRebuildProgress(
        { active: true, label: cur.label || "同步進行中" },
        { immediate: true },
      );
    }
    return { started: false, alreadyRunning: true };
  }
  g.__jinliuHistoryBackfill.running = true;
  // 立刻標記進度，避免首屏輪詢在延後啟動前把 UI 清掉
  beginRebuildProgress("補齊歷史報價");
  // 延後啟動重活，先讓 /api/flow 回完 JSON，避免 Render 冷啟動／記憶體尖峰把本次請求打成 HTML 502
  setTimeout(() => {
    void runHistoryBackfill(reason)
      .catch((err) => {
        console.error(`[backfill] failed (${reason}):`, err);
      })
      .finally(() => {
        g.__jinliuHistoryBackfill!.running = false;
      });
  }, 50);
  return { started: true, alreadyRunning: false };
}

export function isHistoryBackfillRunning(): boolean {
  const g = globalThis as typeof globalThis & {
    __jinliuHistoryBackfill?: { running: boolean };
  };
  return Boolean(g.__jinliuHistoryBackfill?.running);
}
