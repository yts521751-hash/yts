import type { MarketBrief, SectorFlow, StockFlow, TideStatus } from "@/lib/types";
import { US_SECTOR_UNIVERSE } from "@/lib/us-sector-universe";
import type { SectorDef } from "@/lib/sector-universe";
import { blendUsFlow, statusFromFlow } from "@/lib/money-flow";
import { computeFearGauge } from "@/lib/fear-gauge";
import {
  US_ACTIVE_FLOW_CACHE,
  US_DATA_PROVENANCE,
  US_LAST_CLOSE_FLOW_CACHE,
  US_STAGING_FLOW_CACHE,
  computeRvolForCode,
  getUsCachedDayQuotes,
  getUsDayIndexChangePct,
  listUsCachedTradingDays,
  nyClock,
  promoteUsStagingToActive,
  readUsCacheFile,
  readUsDeployMeta,
  shouldPromoteUsFlowToActive,
  syncUsQuoteDays,
  writeUsCacheFile,
  writeUsDeployMeta,
  ymdToIso,
  type UsQuoteRow,
} from "@/lib/us-market";
import {
  beginRebuildProgress,
  finishRebuildProgress,
  progressInRange,
  setRebuildProgress,
} from "@/lib/rebuild-progress";

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

export type UsFlowPayload = {
  brief: MarketBrief;
  sectors: SectorFlow[];
  tradingDays: string[];
  source: typeof US_DATA_PROVENANCE | "cache" | "staging";
  builtAt: string;
  deploySlot?: "active" | "staging";
  /** 美股：成交×漲跌 80% + 相對成交量 20% */
  formula?: "us-blend-80-20-rvol";
  flowLabel?: string;
  market: "us";
  dataProvenance?: typeof US_DATA_PROVENANCE;
};

type DayBundle = {
  ymd: string;
  quotes: Map<string, UsQuoteRow>;
  indexChangePct: number | null;
};

function flowForCode(
  day: DayBundle,
  code: string,
  days: DayBundle[],
  dayIndex: number,
) {
  const q = day.quotes.get(code);
  if (!q || !(q.turnover > 0)) return null;
  const quotesByDay = new Map(days.map((d) => [d.ymd, d.quotes]));
  const rvol = computeRvolForCode(
    code,
    days.map((d) => d.ymd),
    quotesByDay,
    dayIndex,
  );
  return blendUsFlow(q.turnover, q.changePct, rvol);
}

function computeSectors(dayData: DayBundle[], universe: SectorDef[]): SectorFlow[] {
  const latest = dayData[0];
  const oldest = dayData[dayData.length - 1];
  const d3Days = dayData.slice(0, Math.min(3, dayData.length));
  const d5Days = dayData.slice(0, Math.min(5, dayData.length));
  const d20Days = dayData.slice(0, Math.min(20, dayData.length));
  const n5 = d5Days.length;
  const n20 = d20Days.length;

  return universe
    .map((def) => {
      type Rich = StockFlow & { pxNow: number; pxOld: number };
      const stocksRich: Rich[] = def.members
        .map((m) => {
          const code = m.code.toUpperCase();
          const latestQ = latest.quotes.get(code);
          const oldestQ = oldest.quotes.get(code);

          let dayAmt = 0;
          let dayFlow = 0;
          let dayIn = 0;
          let dayOut = 0;
          const dayParts = flowForCode(latest, code, dayData, 0);
          if (dayParts) {
            dayAmt = dayParts.amt;
            dayFlow = dayParts.flow;
            dayIn = dayParts.inflow;
            dayOut = dayParts.outflow;
          }

          let d3 = 0;
          let d3Flow = 0;
          d3Days.forEach((day, idx) => {
            const p = flowForCode(day, code, dayData, idx);
            if (!p) return;
            d3 += p.amt;
            d3Flow += p.flow;
          });

          let d5 = 0;
          let d5Flow = 0;
          d5Days.forEach((day, idx) => {
            const p = flowForCode(day, code, dayData, idx);
            if (!p) return;
            d5 += p.amt;
            d5Flow += p.flow;
          });

          let d20 = 0;
          let d20Flow = 0;
          d20Days.forEach((day, idx) => {
            const p = flowForCode(day, code, dayData, idx);
            if (!p) return;
            d20 += p.amt;
            d20Flow += p.flow;
          });

          return {
            code,
            name: latestQ?.name || oldestQ?.name || m.name,
            dayAmt: round1(dayAmt),
            dayFlow: round1(dayFlow),
            dayIn: round1(dayIn),
            dayOut: round1(dayOut),
            d3Flow: round1(d3Flow),
            d5Flow: round1(d5Flow),
            d20Flow: round1(d20Flow),
            d3: round1(d3),
            d5: round1(d5),
            d20: round1(d20),
            changePct: round2(latestQ?.changePct ?? 0),
            pxNow: latestQ?.close ?? 0,
            pxOld: oldestQ?.close ?? 0,
          };
        })
        .filter((s) => s.dayAmt > 0 || s.d5 > 0);

      const stocks: StockFlow[] = stocksRich
        .map(({ pxNow, pxOld: _b, ...rest }) => ({
          ...rest,
          close: round2(pxNow),
        }))
        .sort((a, b) => b.dayFlow - a.dayFlow);

      const dayAmt = stocks.reduce((s, x) => s + x.dayAmt, 0);
      const dayFlow = stocks.reduce((s, x) => s + x.dayFlow, 0);
      const dayIn = stocks.reduce((s, x) => s + x.dayIn, 0);
      const dayOut = stocks.reduce((s, x) => s + x.dayOut, 0);
      const d3 = stocks.reduce((s, x) => s + x.d3, 0);
      const d5 = stocks.reduce((s, x) => s + x.d5, 0);
      const d20 = stocks.reduce((s, x) => s + x.d20, 0);
      const d3Flow = stocks.reduce((s, x) => s + x.d3Flow, 0);
      const d5Flow = stocks.reduce((s, x) => s + x.d5Flow, 0);
      const d20Flow = stocks.reduce((s, x) => s + x.d20Flow, 0);

      const avg5Flow = d5Flow / Math.max(n5, 1);
      const avg20Flow = d20Flow / Math.max(n20, 1);
      const accel = avg5Flow - avg20Flow;
      const avg5Amt = d5 / Math.max(n5, 1);
      const avg20Amt = d20 / Math.max(n20, 1);
      const heat = avg20Amt > 0 ? avg5Amt / avg20Amt : avg5Amt > 0 ? 2 : 1;

      const priced = stocksRich.filter((s) => s.pxNow > 0 && s.pxOld > 0);
      const priceChange20d =
        priced.length > 0
          ? priced.reduce(
              (s, x) => s + ((x.pxNow - x.pxOld) / x.pxOld) * 100,
              0,
            ) / priced.length
          : 0;

      const sectorDayChange =
        stocks.length > 0
          ? stocks.reduce((s, x) => s + x.changePct, 0) / stocks.length
          : 0;
      const indexChg = latest.indexChangePct ?? 0;
      const volumeSpike =
        indexChg <= -1 &&
        sectorDayChange <= -0.5 &&
        dayAmt >= Math.max(0.5, avg20Amt * 1.5);

      const status: TideStatus = statusFromFlow(d5Flow, accel);

      return {
        id: def.id,
        name: def.name,
        dayAmt: round1(dayAmt),
        dayFlow: round1(dayFlow),
        dayIn: round1(dayIn),
        dayOut: round1(dayOut),
        d3Flow: round1(d3Flow),
        d5Flow: round1(d5Flow),
        d20Flow: round1(d20Flow),
        d3: round1(d3),
        d5: round1(d5),
        d20: round1(d20),
        accel: round1(accel),
        heat: round2(heat),
        priceChange20d: round2(priceChange20d),
        status,
        volumeSpike,
        stocks,
        kind: def.kind ?? "industry",
      };
    })
    .filter((s) => s.stocks.length > 0);
}

type RebuildBag = typeof globalThis & {
  __jinliuUsRebuild?: { running: boolean };
};

function rebuildBag() {
  const g = globalThis as RebuildBag;
  if (!g.__jinliuUsRebuild) g.__jinliuUsRebuild = { running: false };
  return g.__jinliuUsRebuild;
}

export async function rebuildUsFlowPayload(options?: {
  days?: number;
  promote?: boolean;
  cacheOnly?: boolean;
  manageProgress?: boolean;
  skipKlineWarm?: boolean;
}): Promise<UsFlowPayload> {
  await writeUsDeployMeta({ syncing: true, lastError: null });
  const manageProgress = options?.manageProgress !== false;
  const cacheOnly = Boolean(options?.cacheOnly);
  if (manageProgress) beginRebuildProgress("同步美股金流");
  else setRebuildProgress({ label: "重算美股金流" });

  try {
    const needDays = options?.days ?? 20;
    if (!cacheOnly) {
      if (manageProgress) {
        setRebuildProgress({ percent: 5, label: "抓取 Yahoo 美股日 K" });
      }
      await syncUsQuoteDays({
        force: false,
        onProgress: (done, total, sym) => {
          if (!manageProgress) return;
          setRebuildProgress({
            percent: progressInRange(5, 40, done, total),
            label: `Yahoo 日 K ${done}/${total}${sym ? ` ${sym}` : ""}`,
          });
        },
      });
    }

    const tradingDaysRaw = await listUsCachedTradingDays(needDays, 80);
    const clock = nyClock();
    // 18:00 ET 前不用「今天」未定稿日
    const tradingDays =
      clock.isWeekday && clock.mins < 18 * 60
        ? tradingDaysRaw.filter((d) => d !== clock.ymd)
        : tradingDaysRaw;

    if (tradingDays.length < 5) {
      throw new Error("無法取得足夠美股交易日（Yahoo 可能暫不可用）");
    }

    const dayData: DayBundle[] = [];
    for (const ymd of tradingDays) {
      const quotesMap = await getUsCachedDayQuotes(ymd);
      if (!quotesMap?.size) continue;
      const indexChangePct = await getUsDayIndexChangePct(ymd);
      dayData.push({
        ymd,
        quotes: quotesMap,
        indexChangePct,
      });
      if (manageProgress) {
        setRebuildProgress({
          percent: progressInRange(42, 55, dayData.length, tradingDays.length),
          label: `組裝美股金流 ${dayData.length}/${tradingDays.length}`,
        });
      }
    }
    if (dayData.length < 5) {
      throw new Error("美股成交日資料不足，請稍後再試");
    }

    const latest = dayData[0];
    const sectors = computeSectors(dayData, US_SECTOR_UNIVERSE);
    const indexChangePct = latest.indexChangePct ?? 0;
    const fear = await computeFearGauge(
      dayData
        .map((d) => d.indexChangePct)
        .filter((x): x is number => x != null && Number.isFinite(x)),
    );

    const payload: UsFlowPayload = {
      brief: {
        date: ymdToIso(latest.ymd),
        indexChangePct: round2(indexChangePct),
        fearLabel: fear.label,
        fearScore: fear.score,
        updatedAt: new Date().toLocaleString("zh-TW", {
          hour12: false,
          timeZone: "America/New_York",
        }),
        isDemo: false,
      },
      sectors,
      tradingDays: dayData.map((d) => d.ymd),
      source: US_DATA_PROVENANCE,
      builtAt: new Date().toISOString(),
      deploySlot: "staging",
      formula: "us-blend-80-20-rvol",
      flowLabel: "美股金流（成交×漲跌＋相對成交量）",
      market: "us",
      dataProvenance: US_DATA_PROVENANCE,
    };

    await writeUsCacheFile(US_STAGING_FLOW_CACHE, {
      ...payload,
      expiresAt: Date.now() + 1000 * 60 * 60 * 12,
    });
    await writeUsDeployMeta({
      lastBuildAt: payload.builtAt,
      stagingBuiltAt: payload.builtAt,
    });

    const existingActive = await getActiveUsFlowPayload();
    const doPromote =
      shouldPromoteUsFlowToActive(options?.promote) || !existingActive;
    if (doPromote) {
      await promoteUsStagingToActive();
      await writeUsCacheFile(US_LAST_CLOSE_FLOW_CACHE, {
        ...payload,
        deploySlot: "active",
      });
      console.log(`[us-rebuild] promoted active (${payload.brief.date})`);
    } else {
      console.log(
        "[us-rebuild] staging only — keep last-close until 18:00 ET cutover",
      );
    }

    // 暖機產業 K
    if (!options?.skipKlineWarm) {
      try {
        if (manageProgress) {
          setRebuildProgress({ percent: 70, label: "重算美股產業 K 線" });
        }
        const { warmUsSectorKlineCaches } = await import("@/lib/sector-kline-us");
        await warmUsSectorKlineCaches(US_SECTOR_UNIVERSE, {
          onProgress: (done, total) => {
            if (!manageProgress) return;
            setRebuildProgress({
              percent: progressInRange(70, 95, done, total),
              label: `美股產業 K ${done}/${total}`,
            });
          },
        });
      } catch (err) {
        console.warn("[us-rebuild] kline warm failed:", err);
      }
    }

    await writeUsDeployMeta({ syncing: false, lastError: null });
    if (manageProgress) finishRebuildProgress(true);
    return { ...payload, deploySlot: doPromote ? "active" : "staging" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeUsDeployMeta({ syncing: false, lastError: message });
    if (manageProgress) finishRebuildProgress(false, message);
    throw err;
  }
}

export function requestUsBackgroundRebuild(reason = "api"): {
  started: boolean;
  alreadyRunning: boolean;
} {
  const bag = rebuildBag();
  if (bag.running) return { started: false, alreadyRunning: true };
  bag.running = true;
  beginRebuildProgress("同步美股中");
  void rebuildUsFlowPayload({
    promote: reason.startsWith("cron:") || reason.includes("18:"),
  })
    .then((p) => {
      console.log(
        `[us-rebuild] ok (${reason}): ${p.brief.date} sectors=${p.sectors.length}`,
      );
    })
    .catch((err) => {
      console.error(`[us-rebuild] failed (${reason}):`, err);
    })
    .finally(() => {
      bag.running = false;
    });
  return { started: true, alreadyRunning: false };
}

export function isUsRebuildRunning(): boolean {
  return rebuildBag().running;
}

export async function getActiveUsFlowPayload(): Promise<UsFlowPayload | null> {
  const active = await readUsCacheFile<UsFlowPayload & { expiresAt?: number }>(
    US_ACTIVE_FLOW_CACHE,
  );
  if (active?.sectors?.length && "dayFlow" in (active.sectors[0] ?? {})) {
    return { ...active, source: "cache", deploySlot: "active", market: "us" };
  }

  const lastClose = await readUsCacheFile<UsFlowPayload>(US_LAST_CLOSE_FLOW_CACHE);
  if (lastClose?.sectors?.length) {
    return { ...lastClose, source: "cache", deploySlot: "active", market: "us" };
  }

  const staging = await readUsCacheFile<UsFlowPayload>(US_STAGING_FLOW_CACHE);
  if (staging?.sectors?.length) {
    const promoted: UsFlowPayload = {
      ...staging,
      source: "cache",
      deploySlot: "active",
      market: "us",
    };
    await writeUsCacheFile(US_ACTIVE_FLOW_CACHE, promoted);
    await writeUsCacheFile(US_LAST_CLOSE_FLOW_CACHE, promoted);
    await writeUsDeployMeta({
      syncing: false,
      lastError: null,
      lastPromoteAt: new Date().toISOString(),
      activeBuiltAt: staging.builtAt || new Date().toISOString(),
    });
    return promoted;
  }
  return null;
}

export async function getUsDeployStatus() {
  const meta = await readUsDeployMeta();
  const { isR2Enabled } = await import("@/lib/r2-cache");
  const { getCacheDir } = await import("@/lib/tw-market");
  const quoteDays = await listUsCachedTradingDays(60).catch(() => [] as string[]);
  const cacheDir = getCacheDir();
  return {
    ...meta,
    rebuildRunning: isUsRebuildRunning(),
    market: "us" as const,
    cacheDir: `${cacheDir}/us`,
    r2Enabled: isR2Enabled(),
    r2PrefixHint: "jinliu-cache/us/…",
    quoteDays: quoteDays.length,
    quoteDaysTarget: 60,
    quoteWatermark: quoteDays[0] ?? null,
    flowLabel: "美股金流（成交×漲跌＋相對成交量）",
    dataProvenance: US_DATA_PROVENANCE,
  };
}
