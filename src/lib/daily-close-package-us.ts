/**
 * 美股日終大包（America/New_York 時區排程）。
 * 快取全部寫入 us/ 前綴，不與台股日檔混放。
 */

import "server-only";
import {
  beginRebuildProgress,
  finishRebuildProgress,
  setRebuildProgress,
} from "@/lib/rebuild-progress";
import {
  US_DAILY_CLOSE_META,
  getUsLatestCachedTradingDay,
  nyClock,
  readUsCacheFile,
  syncUsQuoteDays,
  writeUsCacheFile,
  ymdToIso,
} from "@/lib/us-market";

export type UsDailyCloseMeta = {
  asOf: string | null;
  builtAt: string;
  reason: string;
  steps: Array<{ name: string; ok: boolean; detail?: string; ms: number }>;
  artifacts: {
    quotes: boolean;
    flow: boolean;
    stocks: boolean;
    klines: boolean;
    wind: boolean;
    ma: boolean;
    turnover: boolean;
    valuePicks: boolean;
  };
  skipped?: boolean;
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
    __jinliuUsDailyClose?: { running: boolean; promise: Promise<UsDailyCloseMeta> | null };
  };
  if (!g.__jinliuUsDailyClose) {
    g.__jinliuUsDailyClose = { running: false, promise: null };
  }
  return g.__jinliuUsDailyClose;
}

export async function readUsDailyCloseMeta() {
  return readUsCacheFile<UsDailyCloseMeta>(US_DAILY_CLOSE_META);
}

export async function runUsDailyClosePackage(
  reason: string,
): Promise<UsDailyCloseMeta> {
  const b = bag();
  if (b.promise) return b.promise;

  b.running = true;
  beginRebuildProgress("美股日終大包");
  b.promise = (async () => {
    const steps: UsDailyCloseMeta["steps"] = [];
    const artifacts: UsDailyCloseMeta["artifacts"] = {
      quotes: false,
      flow: false,
      stocks: false,
      klines: false,
      wind: false,
      ma: false,
      turnover: false,
      valuePicks: false,
    };

    try {
      setRebuildProgress({ percent: 3, label: "美股：同步 Yahoo 日 K" });
      const qStep = await step("quotes", async () => {
        const days = await syncUsQuoteDays({
          force: reason.includes("force"),
          onProgress: (done, total) => {
            setRebuildProgress({
              percent: Math.min(35, 3 + Math.round((done / Math.max(total, 1)) * 30)),
              label: `美股報價 ${done}/${total}`,
            });
          },
        });
        return days;
      });
      steps.push(qStep);
      artifacts.quotes = Boolean(qStep.ok && (qStep.value?.length ?? 0) > 0);

      setRebuildProgress({ percent: 40, label: "美股：重算金流" });
      const { rebuildUsFlowPayload } = await import("@/lib/build-flow-us");
      const flowStep = await step("flow", () =>
        rebuildUsFlowPayload({
          promote: true,
          cacheOnly: true,
          manageProgress: false,
          skipKlineWarm: false,
        }),
      );
      steps.push(flowStep);
      artifacts.flow = flowStep.ok;
      artifacts.klines = flowStep.ok;

      setRebuildProgress({ percent: 62, label: "美股：個股金流" });
      const { buildUsStockFlowRanking } = await import("@/lib/stock-flow-us");
      const stocksStep = await step("stocks", () =>
        buildUsStockFlowRanking(50, { force: true }),
      );
      steps.push(stocksStep);
      artifacts.stocks = Boolean(stocksStep.ok && stocksStep.value?.rows?.length);

      setRebuildProgress({ percent: 72, label: "美股：成交排行" });
      const { buildUsTurnoverRanking } = await import("@/lib/turnover-us");
      const turnStep = await step("turnover", () =>
        buildUsTurnoverRanking(50, { force: true }),
      );
      steps.push(turnStep);
      artifacts.turnover = Boolean(turnStep.ok && turnStep.value?.rows?.length);

      setRebuildProgress({ percent: 80, label: "美股：風度" });
      const { buildUsWindGauge } = await import("@/lib/wind-gauge-us");
      const windStep = await step("wind", () => buildUsWindGauge({ force: true }));
      steps.push(windStep);
      artifacts.wind = windStep.ok;

      setRebuildProgress({ percent: 88, label: "美股：均線掃描" });
      const { buildUsMaScreener } = await import("@/lib/ma-screener-us");
      const maStep = await step("ma", () => buildUsMaScreener({ force: true }));
      steps.push(maStep);
      artifacts.ma = Boolean(maStep.ok && maStep.value?.rows?.length);

      setRebuildProgress({ percent: 94, label: "美股：價值選股" });
      const { buildUsValuePicks } = await import("@/lib/value-picks-us");
      const valueStep = await step("value", () =>
        buildUsValuePicks({ force: true }),
      );
      steps.push(valueStep);
      artifacts.valuePicks = Boolean(valueStep.ok);

      const latest = await getUsLatestCachedTradingDay();
      const meta: UsDailyCloseMeta = {
        asOf: latest ? ymdToIso(latest) : null,
        builtAt: new Date().toISOString(),
        reason,
        steps: steps.map(({ name, ok, detail, ms }) => ({
          name,
          ok,
          detail,
          ms,
        })),
        artifacts,
        market: "us",
      };
      await writeUsCacheFile(US_DAILY_CLOSE_META, meta);

      try {
        const { flushCacheSideEffects } = await import("@/lib/tw-market");
        await flushCacheSideEffects();
      } catch {
        /* ignore */
      }

      finishRebuildProgress(artifacts.flow);
      return meta;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      finishRebuildProgress(false, message);
      const meta: UsDailyCloseMeta = {
        asOf: null,
        builtAt: new Date().toISOString(),
        reason,
        steps,
        artifacts,
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
