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
  invalidateTradingDaysMemo,
  listCachedTradingDays,
} from "@/lib/tw-market";

/**
 * 增量歷史／日終同步（寫入 CACHE_DIR，有 R2 時 write-through）：
 * 1) 先 hydrate R2（若啟用）
 * 2) 只補水位之後缺的交易日報價／法人（已有日檔略過）
 * 3) 日終大包：若已對齊最新交易日且 artifacts 齊則略過重算
 */
export async function runHistoryBackfill(reason: string) {
  console.log(`[backfill] start (${reason}) cache=${getCacheDir()}`);
  beginRebuildProgress("檢查交易日缺口");

  try {
    try {
      const { hydrateCacheFromR2, isR2Enabled } = await import("@/lib/r2-cache");
      if (isR2Enabled()) {
        setRebuildProgress({ percent: 2, label: "自 R2 還原快取" });
        await hydrateCacheFromR2(getCacheDir());
        invalidateTradingDaysMemo();
      }
    } catch (err) {
      console.warn("[backfill] r2 hydrate:", err);
    }

    const { fillTradingDayGaps } = await import("@/lib/turnover");
    const before = await listCachedTradingDays(HISTORY_TRADING_DAYS);
    setRebuildProgress({
      percent: 5,
      label: `水位檢查（本機 ${before.length} 日）`,
    });

    const gap = await fillTradingDayGaps({
      needDays: HISTORY_TRADING_DAYS,
      onProgress: (p) => {
        const label =
          p.missingTotal > 0
            ? `補缺交易日 ${Math.min(p.fetched, p.missingTotal)}/${p.missingTotal}（略過已有 ${p.skipped}）`
            : p.phase === "done"
              ? `交易日已齊（略過已有 ${p.skipped}）`
              : `檢查缺口（已有 ${p.skipped} 日）`;
        setRebuildProgress({
          percent: progressInRange(5, 40, p.done, Math.max(p.need, 1)),
          label,
        });
      },
    });

    console.log(
      `[backfill] gaps: watermark=${gap.watermark ?? "—"} target=${gap.target} ` +
        `missing=${gap.missing.length} fetched=${gap.fetched} skipped≈${gap.skipped}`,
    );

    setRebuildProgress({
      percent: 42,
      label:
        gap.fetched > 0
          ? "日終大包（含產業 K／均線）"
          : "檢查日終大包是否最新",
    });
    const { runDailyClosePackage } = await import("@/lib/daily-close-package");
    const meta = await runDailyClosePackage(`backfill:${reason}`, {
      skipGapFill: true,
    });

    const quoteDays = await listCachedTradingDays(HISTORY_TRADING_DAYS);
    finishRebuildProgress(true);
    const skipNote = meta.skipped ? " skipped-current" : "";
    console.log(
      `[backfill] done (${reason}) quoteDays=${quoteDays.length} asOf=${meta.asOf ?? "—"}${skipNote}`,
    );
    return {
      meta,
      quoteDays: quoteDays.length,
      target: HISTORY_TRADING_DAYS,
      gap: {
        watermark: gap.watermark,
        targetYmd: gap.target,
        missing: gap.missing.length,
        fetched: gap.fetched,
        skipped: gap.skipped,
      },
    };
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
  beginRebuildProgress("檢查交易日缺口");
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
