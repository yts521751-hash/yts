/**
 * 美股日終大包（America/New_York 時區排程）。
 * 快取全部寫入 us/ 前綴，不與台股日檔混放。
 *
 * 增量：R2 hydrate → 水位／meta 對齊則「資料已是最新」→ 否則只補缺／輕量重算 → flush R2。
 */

import "server-only";
import {
  beginRebuildProgress,
  finishRebuildProgress,
  setRebuildProgress,
} from "@/lib/rebuild-progress";
import {
  isUsMetaAsOfTarget,
  isUsPackageUpToDate,
  prevUsTradingDayYmd,
  resolveUsSyncTargetYmd,
  toCompactYmd,
  usArtifactsComplete,
  type UsPackageArtifacts,
} from "@/lib/gap-sync-us";
import {
  US_ACTIVE_FLOW_CACHE,
  US_DAILY_CLOSE_META,
  ensureUsQuotesUpToDate,
  getUsLatestCachedTradingDay,
  invalidateUsTradingDaysMemo,
  nyClock,
  readUsCacheFile,
  writeUsCacheFile,
  ymdToIso,
} from "@/lib/us-market";

export type UsDailyCloseMeta = {
  asOf: string | null;
  builtAt: string;
  reason: string;
  steps: Array<{ name: string; ok: boolean; detail?: string; ms: number }>;
  artifacts: UsPackageArtifacts;
  skipped?: boolean;
  gap?: {
    watermark: string | null;
    target: string;
    fetchedSymbols: number;
    skippedSymbols: number;
    wroteDays: boolean;
  };
  market: "us";
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
    console.error(`[us-daily-close] ${name} failed:`, detail);
    return { name, ok: false, detail, ms: Date.now() - t0 };
  }
}

function bag() {
  const g = globalThis as typeof globalThis & {
    __jinliuUsDailyClose?: {
      running: boolean;
      promise: Promise<UsDailyCloseMeta> | null;
    };
  };
  if (!g.__jinliuUsDailyClose) {
    g.__jinliuUsDailyClose = { running: false, promise: null };
  }
  return g.__jinliuUsDailyClose;
}

export async function readUsDailyCloseMeta() {
  return readUsCacheFile<UsDailyCloseMeta>(US_DAILY_CLOSE_META);
}

async function ensureUsHydrated() {
  try {
    const { getCacheDir } = await import("@/lib/tw-market");
    const { hydrateCacheFromR2, isR2Enabled } = await import("@/lib/r2-cache");
    if (isR2Enabled()) {
      setRebuildProgress({ percent: 2, label: "自 R2 還原美股快取" });
      const result = await hydrateCacheFromR2(getCacheDir());
      invalidateUsTradingDaysMemo();
      console.log(
        `[us-daily-close] r2 hydrate: downloaded=${result.downloaded} skipped=${result.skipped}`,
      );
    }
  } catch (err) {
    console.warn("[us-daily-close] r2 hydrate skipped:", err);
  }
}

async function flushUploadsSafe() {
  try {
    const { flushCacheSideEffects } = await import("@/lib/tw-market");
    setRebuildProgress({ percent: 99, label: "寫入 R2 快照（us/）" });
    await flushCacheSideEffects();
  } catch (err) {
    console.warn("[us-daily-close] r2 flush:", err);
  }
}

export async function runUsDailyClosePackage(
  reason: string,
  options?: { force?: boolean },
): Promise<UsDailyCloseMeta> {
  const b = bag();
  if (b.promise) return b.promise;

  b.running = true;
  beginRebuildProgress("檢查美股快取");
  b.promise = (async () => {
    const steps: UsDailyCloseMeta["steps"] = [];
    let gapMeta: UsDailyCloseMeta["gap"];

    try {
      await ensureUsHydrated();

      const target = resolveUsSyncTargetYmd();
      const prevMeta = await readUsDailyCloseMeta();
      const active = await readUsCacheFile<{ sectors?: unknown[] }>(
        US_ACTIVE_FLOW_CACHE,
      );
      const latestBefore = await getUsLatestCachedTradingDay();
      const metaMatchesTarget = isUsMetaAsOfTarget(prevMeta, target);
      const packageCurrent =
        latestBefore != null &&
        latestBefore >= target &&
        isUsPackageUpToDate(prevMeta, latestBefore);

      // 激進快路徑：R2／本機已有對齊目標日的大包＋active flow
      if (
        !options?.force &&
        prevMeta &&
        active?.sectors?.length &&
        (metaMatchesTarget || packageCurrent)
      ) {
        // 仍檢查宇宙缺碼（例如新納入的流動股）；少數缺碼才 merge，不重算衍生
        setRebuildProgress({ percent: 20, label: "檢查美股報價水位" });
        const quoteCheck = await ensureUsQuotesUpToDate({
          force: false,
          targetYmd: target,
          onProgress: (done, total) => {
            if (total <= 0) return;
            setRebuildProgress({
              percent: Math.min(40, 20 + Math.round((done / total) * 15)),
              label: `補齊美股宇宙 ${done}/${total}`,
            });
          },
        });
        steps.push({
          name: "quotes",
          ok: true,
          detail:
            quoteCheck.fetchedSymbols === 0
              ? `skip-current quotes cached watermark=${quoteCheck.watermark}`
              : `merged ${quoteCheck.fetchedSymbols} symbols into quotes`,
          ms: 0,
        });
        gapMeta = {
          watermark: quoteCheck.watermark,
          target: quoteCheck.target,
          fetchedSymbols: quoteCheck.fetchedSymbols,
          skippedSymbols: quoteCheck.skippedSymbols,
          wroteDays: quoteCheck.wroteDays,
        };

        // 若只是 merge 新宇宙代號進日檔，需重算成值／金流才看得到新名字
        if (quoteCheck.fetchedSymbols > 0 && quoteCheck.wroteDays) {
          setRebuildProgress({ percent: 55, label: "美股：更新成值／金流（新宇宙）" });
          const light = await rebuildUsDerivatives({
            forceTurnover: true,
            forceValue: true,
            forceStocks: true,
            forceWind: false,
            skipKlineWarm: true,
            lightValue: true,
          });
          steps.push(...light.steps);
          const latest = await getUsLatestCachedTradingDay();
          const meta: UsDailyCloseMeta = {
            asOf: latest ? ymdToIso(latest) : prevMeta.asOf,
            builtAt: new Date().toISOString(),
            reason: `${reason}:universe-merge`,
            steps,
            artifacts: {
              ...prevMeta.artifacts,
              ...light.artifacts,
              quotes: true,
              klines: true,
              ma: true,
            },
            skipped: false,
            gap: gapMeta,
            market: "us",
          };
          await writeUsCacheFile(US_DAILY_CLOSE_META, meta);
          await flushUploadsSafe();
          setRebuildProgress({ percent: 100, label: "美股同步完成" });
          finishRebuildProgress(true);
          return meta;
        }

        const skippedMeta: UsDailyCloseMeta = {
          asOf: prevMeta.asOf,
          builtAt: prevMeta.builtAt,
          reason: `${reason}:skip-current`,
          steps: [
            ...steps,
            {
              name: "skip",
              ok: true,
              detail: `已是最新 asOf=${prevMeta.asOf} target=${target}`,
              ms: 0,
            },
          ],
          artifacts: prevMeta.artifacts,
          skipped: true,
          gap: gapMeta,
          market: "us",
        };
        await writeUsCacheFile(US_DAILY_CLOSE_META, skippedMeta).catch(
          () => null,
        );
        await flushUploadsSafe();
        setRebuildProgress({ percent: 100, label: "資料已是最新" });
        finishRebuildProgress(true);
        console.log(
          `[us-daily-close] skip (${reason}): asOf=${prevMeta.asOf} target=${target}`,
        );
        return skippedMeta;
      }

      setRebuildProgress({ percent: 8, label: "美股：檢查／補齊 Yahoo 日 K" });
      const qStep = await step("quotes", async () => {
        return ensureUsQuotesUpToDate({
          force: Boolean(options?.force) || reason.includes("force"),
          targetYmd: target,
          onProgress: (done, total, label) => {
            setRebuildProgress({
              percent: Math.min(38, 8 + Math.round((done / Math.max(total, 1)) * 28)),
              label:
                total > 0 && done < total
                  ? `美股報價 ${done}/${total}${label ? `（${label}）` : ""}`
                  : done === total && total > 0
                    ? `美股報價已齊（${total}）`
                    : "美股報價水位檢查",
            });
          },
        });
      });
      steps.push({
        name: qStep.name,
        ok: qStep.ok,
        detail:
          qStep.detail ??
          (qStep.value
            ? `fetched=${qStep.value.fetchedSymbols} skipped=${qStep.value.skippedSymbols} watermark=${qStep.value.watermark}`
            : undefined),
        ms: qStep.ms,
      });
      if (qStep.ok && qStep.value) {
        gapMeta = {
          watermark: qStep.value.watermark,
          target: qStep.value.target,
          fetchedSymbols: qStep.value.fetchedSymbols,
          skippedSymbols: qStep.value.skippedSymbols,
          wroteDays: qStep.value.wroteDays,
        };
      }

      const latestQuote = await getUsLatestCachedTradingDay();
      const metaAfterQuotes = await readUsDailyCloseMeta();
      const packageNow =
        latestQuote != null &&
        latestQuote >= target &&
        isUsPackageUpToDate(metaAfterQuotes, latestQuote);

      // 報價補完後若大包已對齊（例如只差 hydrate）→ 略過衍生
      if (
        !options?.force &&
        metaAfterQuotes &&
        (isUsMetaAsOfTarget(metaAfterQuotes, target) || packageNow) &&
        !(qStep.value?.wroteDays && (qStep.value.fetchedSymbols ?? 0) > 0)
      ) {
        const skippedMeta: UsDailyCloseMeta = {
          asOf: metaAfterQuotes.asOf,
          builtAt: metaAfterQuotes.builtAt,
          reason: `${reason}:skip-current-after-quotes`,
          steps: [
            ...steps,
            {
              name: "skip",
              ok: true,
              detail: `報價已齊且大包最新 asOf=${metaAfterQuotes.asOf}`,
              ms: 0,
            },
          ],
          artifacts: metaAfterQuotes.artifacts,
          skipped: true,
          gap: gapMeta,
          market: "us",
        };
        await writeUsCacheFile(US_DAILY_CLOSE_META, skippedMeta).catch(
          () => null,
        );
        await flushUploadsSafe();
        setRebuildProgress({ percent: 100, label: "資料已是最新" });
        finishRebuildProgress(true);
        return skippedMeta;
      }

      const prevAsOfYmd = prevMeta?.asOf
        ? toCompactYmd(prevMeta.asOf)
        : null;
      // 小缺口：水位只前進約 1 個交易日，且前次 artifacts 齊 → 輕量衍生
      const tinyGap =
        Boolean(latestQuote) &&
        Boolean(prevAsOfYmd) &&
        usArtifactsComplete(prevMeta?.artifacts) &&
        prevUsTradingDayYmd(latestQuote!) === prevAsOfYmd;

      const artifacts: UsPackageArtifacts = {
        quotes: Boolean(qStep.ok && (qStep.value?.days.length ?? 0) > 0),
        flow: false,
        stocks: false,
        klines: true,
        wind: false,
        ma: true,
        turnover: false,
        valuePicks: false,
      };

      if (tinyGap) {
        setRebuildProgress({ percent: 42, label: "美股輕量日終（約 1 日缺口）" });
      } else {
        setRebuildProgress({ percent: 42, label: "美股：重算金流與衍生" });
      }

      const derived = await rebuildUsDerivatives({
        forceTurnover: true,
        forceValue: !tinyGap,
        forceStocks: true,
        forceWind: true,
        skipKlineWarm: true,
        lightValue: Boolean(tinyGap),
      });
      steps.push(...derived.steps);
      Object.assign(artifacts, derived.artifacts);
      artifacts.quotes = Boolean(
        artifacts.quotes || (qStep.ok && (qStep.value?.days.length ?? 0) > 0),
      );

      const latest = await getUsLatestCachedTradingDay();
      const meta: UsDailyCloseMeta = {
        asOf: latest ? ymdToIso(latest) : null,
        builtAt: new Date().toISOString(),
        reason: tinyGap ? `${reason}:tiny-gap` : reason,
        steps,
        artifacts,
        skipped: false,
        gap: gapMeta,
        market: "us",
      };
      await writeUsCacheFile(US_DAILY_CLOSE_META, meta);
      await flushUploadsSafe();

      const ok = Boolean(artifacts.flow);
      setRebuildProgress({
        percent: 100,
        label: ok ? "美股同步完成" : "美股同步未完成",
      });
      finishRebuildProgress(ok, ok ? undefined : "美股大包未完成");
      return meta;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      finishRebuildProgress(false, message);
      const meta: UsDailyCloseMeta = {
        asOf: null,
        builtAt: new Date().toISOString(),
        reason,
        steps,
        artifacts: {
          quotes: false,
          flow: false,
          stocks: false,
          klines: false,
          wind: false,
          ma: false,
          turnover: false,
          valuePicks: false,
        },
        gap: gapMeta,
        market: "us",
      };
      await writeUsCacheFile(US_DAILY_CLOSE_META, meta).catch(() => null);
      throw err;
    } finally {
      b.running = false;
      b.promise = null;
    }
  })();

  return b.promise;
}

async function rebuildUsDerivatives(opts: {
  forceTurnover: boolean;
  forceValue: boolean;
  forceStocks: boolean;
  forceWind: boolean;
  skipKlineWarm: boolean;
  lightValue: boolean;
}): Promise<{
  steps: UsDailyCloseMeta["steps"];
  artifacts: Partial<UsPackageArtifacts>;
}> {
  const steps: UsDailyCloseMeta["steps"] = [];
  const artifacts: Partial<UsPackageArtifacts> = {};

  setRebuildProgress({ percent: 45, label: "美股：重算金流" });
  const { rebuildUsFlowPayload } = await import("@/lib/build-flow-us");
  const flowStep = await step("flow", () =>
    rebuildUsFlowPayload({
      promote: true,
      cacheOnly: true,
      manageProgress: false,
      skipKlineWarm: opts.skipKlineWarm,
    }),
  );
  steps.push({
    name: flowStep.name,
    ok: flowStep.ok,
    detail: flowStep.detail,
    ms: flowStep.ms,
  });
  artifacts.flow = flowStep.ok;
  artifacts.klines = true;

  setRebuildProgress({ percent: 62, label: "美股：個股金流" });
  const { buildUsStockFlowRanking } = await import("@/lib/stock-flow-us");
  const stocksStep = await step("stocks", () =>
    buildUsStockFlowRanking(50, { force: opts.forceStocks }),
  );
  steps.push({
    name: stocksStep.name,
    ok: stocksStep.ok,
    detail: stocksStep.detail,
    ms: stocksStep.ms,
  });
  artifacts.stocks = Boolean(stocksStep.ok && stocksStep.value?.rows?.length);

  setRebuildProgress({ percent: 72, label: "美股：成交排行" });
  const { buildUsTurnoverRanking } = await import("@/lib/turnover-us");
  const turnStep = await step("turnover", () =>
    buildUsTurnoverRanking(50, { force: opts.forceTurnover }),
  );
  steps.push({
    name: turnStep.name,
    ok: turnStep.ok,
    detail: turnStep.detail,
    ms: turnStep.ms,
  });
  artifacts.turnover = Boolean(turnStep.ok && turnStep.value?.rows?.length);

  setRebuildProgress({ percent: 82, label: "美股：風度" });
  const { buildUsWindGauge } = await import("@/lib/wind-gauge-us");
  const windStep = await step("wind", () =>
    buildUsWindGauge({ force: opts.forceWind }),
  );
  steps.push({
    name: windStep.name,
    ok: windStep.ok,
    detail: windStep.detail,
    ms: windStep.ms,
  });
  artifacts.wind = windStep.ok;
  artifacts.ma = true;

  setRebuildProgress({
    percent: 92,
    label: opts.lightValue ? "美股：價值選股（沿用 EPS 快取）" : "美股：價值選股",
  });
  const { buildUsValuePicks } = await import("@/lib/value-picks-us");
  const valueStep = await step("value", () =>
    buildUsValuePicks({ force: opts.forceValue && !opts.lightValue }),
  );
  steps.push({
    name: valueStep.name,
    ok: valueStep.ok,
    detail: valueStep.detail,
    ms: valueStep.ms,
  });
  artifacts.valuePicks = Boolean(valueStep.ok);

  return { steps, artifacts };
}

export function requestUsDailyClosePackage(reason: string): {
  started: boolean;
  alreadyRunning: boolean;
} {
  const b = bag();
  if (b.running || b.promise) {
    return { started: false, alreadyRunning: true };
  }
  void runUsDailyClosePackage(reason).catch((err) => {
    console.error("[us-daily-close] failed", err);
  });
  return { started: true, alreadyRunning: false };
}

export function isUsDailyCloseRunning() {
  return bag().running || Boolean(bag().promise);
}

/** 美東 18:00–20:00 平日適合跑日終 */
export function isUsClosePackageWindow(now = new Date()) {
  const { isWeekday, mins } = nyClock(now);
  return isWeekday && mins >= 18 * 60 && mins <= 20 * 60;
}
