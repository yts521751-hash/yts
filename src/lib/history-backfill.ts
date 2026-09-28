import "server-only";
import {
  artifactsComplete,
  isMetaAsOfTarget,
  isPackageUpToDate,
  resolveSyncTargetYmd,
} from "@/lib/gap-sync";
import {
  beginRebuildProgress,
  finishRebuildProgress,
  progressInRange,
  setRebuildProgress,
} from "@/lib/rebuild-progress";
import {
  getCacheDir,
  getLatestCachedTradingDay,
  HISTORY_TRADING_DAYS,
  invalidateTradingDaysMemo,
  listCachedTradingDays,
} from "@/lib/tw-market";

/**
 * 增量歷史／日終同步（寫入 CACHE_DIR，有 R2 時 write-through）：
 * 1) 先 hydrate R2（若啟用）
 * 2) 若日終 meta.asOf＝目標交易日且有 active flow → 立刻略過（第二下同步應極快）
 * 3) 只補水位之後缺的交易日報價／法人（已有日檔略過）
 * 4) 日終大包：若已對齊最新交易日且 artifacts 齊則略過重算
 * 5) flush R2 上傳，避免 Free 休眠丟掉 snapshot
 */
export async function runHistoryBackfill(reason: string) {
  console.log(`[backfill] start (${reason}) cache=${getCacheDir()}`);
  beginRebuildProgress("檢查交易日缺口");

  try {
    try {
      const { hydrateCacheFromR2, isR2Enabled } = await import("@/lib/r2-cache");
      if (isR2Enabled()) {
        setRebuildProgress({ percent: 2, label: "自 R2 還原快取" });
        const hydrated = await hydrateCacheFromR2(getCacheDir());
        invalidateTradingDaysMemo();
        console.log(
          `[backfill] r2 hydrate: downloaded=${hydrated.downloaded} skipped=${hydrated.skipped} total=${hydrated.total}`,
        );
      }
    } catch (err) {
      console.warn("[backfill] r2 hydrate:", err);
    }

    const { readDailyCloseMeta } = await import("@/lib/daily-close-package");
    const { getActiveFlowPayload } = await import("@/lib/build-flow");
    const target = resolveSyncTargetYmd();
    const latestQuote = await getLatestCachedTradingDay();
    const prevMeta = await readDailyCloseMeta();
    const active = await getActiveFlowPayload();

    // 激進快路徑：active flow + daily-close meta.asOf＝目標交易日
    // → 略過一切交易所抓取與衍生重算（第二下同步應秒級「資料已是最新」）
    const metaMatchesTarget = isMetaAsOfTarget(prevMeta, target);
    const packageCurrent =
      latestQuote != null &&
      latestQuote >= target &&
      isPackageUpToDate(prevMeta, latestQuote);
    if (prevMeta && active && (metaMatchesTarget || packageCurrent)) {
      const quoteDays = await listCachedTradingDays(HISTORY_TRADING_DAYS);
      setRebuildProgress({ percent: 100, label: "資料已是最新" });
      finishRebuildProgress(true);
      console.log(
        `[backfill] skip-current (${reason}): asOf=${prevMeta.asOf} ` +
          `watermark=${latestQuote ?? "—"} target=${target} ` +
          `quoteDays=${quoteDays.length} metaMatch=${metaMatchesTarget} ` +
          `packageCurrent=${packageCurrent}`,
      );
      try {
        const { flushCacheSideEffects } = await import("@/lib/tw-market");
        await flushCacheSideEffects();
      } catch {
        /* ignore */
      }
      return {
        meta: {
          ...prevMeta,
          skipped: true,
          reason: `backfill:${reason}:skip-current`,
        },
        quoteDays: quoteDays.length,
        target: HISTORY_TRADING_DAYS,
        gap: {
          watermark: latestQuote,
          targetYmd: target,
          missing: 0,
          fetched: 0,
          skipped: quoteDays.length,
        },
      };
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

    try {
      const { flushCacheSideEffects } = await import("@/lib/tw-market");
      setRebuildProgress({ percent: 99, label: "寫入 R2 快照" });
      await flushCacheSideEffects();
      console.log(`[backfill] cache side-effects flushed`);
    } catch (err) {
      console.warn("[backfill] r2 flush:", err);
    }

    finishRebuildProgress(true);
    const skipNote = meta.skipped ? " skipped-current" : "";
    console.log(
      `[backfill] done (${reason}) quoteDays=${quoteDays.length} asOf=${meta.asOf ?? "—"}${skipNote} ` +
        `artifactsComplete=${artifactsComplete(meta.artifacts)}`,
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
