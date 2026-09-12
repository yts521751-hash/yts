import type { MarketBrief, SectorFlow, StockFlow, TideStatus } from "@/lib/types";
import { SECTOR_UNIVERSE } from "@/lib/sector-universe";
import { signedFlowFromQuote, statusFromFlow } from "@/lib/money-flow";
import {
  ACTIVE_FLOW_CACHE,
  STAGING_FLOW_CACHE,
  listRecentTradingDays,
  loadMergedQuotesDay,
  promoteStagingToActive,
  readCacheFile,
  readDeployMeta,
  writeCacheFile,
  writeDeployMeta,
  ymdToIso,
  type QuoteRow,
} from "@/lib/tw-market";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

export type FlowPayload = {
  brief: MarketBrief;
  sectors: SectorFlow[];
  tradingDays: string[];
  source: "twse+tpex" | "cache" | "staging";
  builtAt: string;
  deploySlot?: "active" | "staging";
};

type DayQuotes = {
  ymd: string;
  quotes: Map<string, QuoteRow>;
  indexChangePct: number | null;
};

function fearFromIndex(changePct: number): { label: string; score: number } {
  if (changePct <= -2) return { label: "恐慌", score: 88 };
  if (changePct <= -1) return { label: "偏恐慌", score: 72 };
  if (changePct < -0.3) return { label: "偏謹慎", score: 58 };
  if (changePct < 0.5) return { label: "中性", score: 48 };
  if (changePct < 1.5) return { label: "偏樂觀", score: 35 };
  return { label: "偏熱絡", score: 22 };
}

type RebuildBag = typeof globalThis & {
  __jinchaoRebuild?: { running: boolean };
};

function rebuildBag() {
  const g = globalThis as RebuildBag;
  if (!g.__jinchaoRebuild) g.__jinchaoRebuild = { running: false };
  return g.__jinchaoRebuild;
}

function computeSectors(dayData: DayQuotes[]): SectorFlow[] {
  const latest = dayData[0];
  const oldest = dayData[dayData.length - 1];
  const d5Days = dayData.slice(0, Math.min(5, dayData.length));
  const d20Days = dayData.slice(0, Math.min(20, dayData.length));
  const n5 = d5Days.length;
  const n20 = d20Days.length;

  return SECTOR_UNIVERSE.map((def) => {
    type Rich = StockFlow & { pxNow: number; pxOld: number };
    const stocksRich = def.members
      .map((m) => {
        const code = m.code;
        const latestQ = latest.quotes.get(code);
        const oldestQ = oldest.quotes.get(code);

        let dayAmt = 0;
        let dayFlow = 0;
        let dayIn = 0;
        let dayOut = 0;
        if (latestQ) {
          const p = signedFlowFromQuote(latestQ.turnover, latestQ.changePct);
          dayAmt = p.amt;
          dayFlow = p.flow;
          dayIn = p.inflow;
          dayOut = p.outflow;
        }

        let d5 = 0;
        let d5Flow = 0;
        for (const day of d5Days) {
          const q = day.quotes.get(code);
          if (!q) continue;
          const p = signedFlowFromQuote(q.turnover, q.changePct);
          d5 += p.amt;
          d5Flow += p.flow;
        }

        let d20 = 0;
        let d20Flow = 0;
        for (const day of d20Days) {
          const q = day.quotes.get(code);
          if (!q) continue;
          const p = signedFlowFromQuote(q.turnover, q.changePct);
          d20 += p.amt;
          d20Flow += p.flow;
        }

        const pxNow = latestQ?.close ?? 0;
        const pxOld = oldestQ?.close ?? 0;
        const changePct = latestQ?.changePct ?? 0;

        if (dayAmt === 0 && d5 === 0 && d20 === 0 && !pxNow) return null;

        return {
          code,
          name: latestQ?.name || oldestQ?.name || m.name,
          dayAmt: round1(dayAmt),
          dayFlow: round1(dayFlow),
          dayIn: round1(dayIn),
          dayOut: round1(dayOut),
          d5Flow: round1(d5Flow),
          d20Flow: round1(d20Flow),
          d5: round1(d5),
          d20: round1(d20),
          changePct: round2(changePct),
          pxNow,
          pxOld,
        } satisfies Rich;
      })
      .filter(Boolean) as Rich[];

    const stocks: StockFlow[] = stocksRich
      .map(({ pxNow: _a, pxOld: _b, ...rest }) => rest)
      .sort((a, b) => b.dayFlow - a.dayFlow);

    const dayAmt = stocks.reduce((s, x) => s + x.dayAmt, 0);
    const dayFlow = stocks.reduce((s, x) => s + x.dayFlow, 0);
    const dayIn = stocks.reduce((s, x) => s + x.dayIn, 0);
    const dayOut = stocks.reduce((s, x) => s + x.dayOut, 0);
    const d5 = stocks.reduce((s, x) => s + x.d5, 0);
    const d20 = stocks.reduce((s, x) => s + x.d20, 0);
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
      d5Flow: round1(d5Flow),
      d20Flow: round1(d20Flow),
      d5: round1(d5),
      d20: round1(d20),
      accel: round1(accel),
      heat: round2(heat),
      priceChange20d: round2(priceChange20d),
      status,
      volumeSpike,
      stocks,
    };
  }).filter((s) => s.stocks.length > 0);
}

/** 重建：寫 staging → 原子切 active（灰度） */
export async function rebuildFlowPayload(options?: {
  days?: number;
}): Promise<FlowPayload> {
  await writeDeployMeta({ syncing: true, lastError: null });
  try {
    const needDays = options?.days ?? 20;
    const tradingDays = await listRecentTradingDays(needDays, 50);
    if (tradingDays.length < 5) {
      throw new Error("無法取得足夠交易日（證交所可能維護中或尚未收盤）");
    }

    const dayData: DayQuotes[] = [];
    for (const ymd of tradingDays) {
      const bundle = await loadMergedQuotesDay(ymd);
      if (bundle?.quotes?.length) {
        dayData.push({
          ymd,
          quotes: new Map(bundle.quotes.map((q) => [q.code, q])),
          indexChangePct: bundle.indexChangePct,
        });
      }
      await sleep(100);
    }
    if (dayData.length < 5) {
      throw new Error("成交金額日資料不足，請稍後再試");
    }

    const latest = dayData[0];
    const sectors = computeSectors(dayData);
    const indexChangePct = latest.indexChangePct ?? 0;
    const fear = fearFromIndex(indexChangePct);

    const payload: FlowPayload = {
      brief: {
        date: ymdToIso(latest.ymd),
        indexChangePct: round2(indexChangePct),
        fearLabel: fear.label,
        fearScore: fear.score,
        updatedAt: new Date().toLocaleString("zh-TW", { hour12: false }),
        isDemo: false,
      },
      sectors,
      tradingDays: dayData.map((d) => d.ymd),
      source: "twse+tpex",
      builtAt: new Date().toISOString(),
      deploySlot: "staging",
    };

    await writeCacheFile(STAGING_FLOW_CACHE, {
      ...payload,
      expiresAt: Date.now() + 1000 * 60 * 60 * 12,
    });
    await writeDeployMeta({
      lastBuildAt: payload.builtAt,
      stagingBuiltAt: payload.builtAt,
    });
    await promoteStagingToActive();

    return { ...payload, deploySlot: "active" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeDeployMeta({ syncing: false, lastError: message });
    throw err;
  }
}

/** 背景重建（單飛）：API force=1 只觸發，不阻塞 */
export function requestBackgroundRebuild(reason = "api"): {
  started: boolean;
  alreadyRunning: boolean;
} {
  const bag = rebuildBag();
  if (bag.running) return { started: false, alreadyRunning: true };
  bag.running = true;
  void rebuildFlowPayload()
    .then((p) => {
      console.log(
        `[rebuild] ok (${reason}): ${p.brief.date} sectors=${p.sectors.length}`,
      );
    })
    .catch((err) => {
      console.error(`[rebuild] failed (${reason}):`, err);
    })
    .finally(() => {
      bag.running = false;
    });
  return { started: true, alreadyRunning: false };
}

export function isRebuildRunning(): boolean {
  return rebuildBag().running;
}

/** 永遠讀 active；請求路徑不做長同步 */
export async function getActiveFlowPayload(): Promise<FlowPayload | null> {
  const active = await readCacheFile<FlowPayload & { expiresAt?: number }>(
    ACTIVE_FLOW_CACHE,
  );
  if (active?.sectors?.length && "dayFlow" in (active.sectors[0] ?? {})) {
    return { ...active, source: "cache", deploySlot: "active" };
  }

  for (const legacy of [
    "flow-turnover-latest.json",
    "flow-latest.json",
  ]) {
    const old = await readCacheFile<FlowPayload>(legacy);
    if (old?.sectors?.length && "dayFlow" in (old.sectors[0] ?? {})) {
      await writeCacheFile(ACTIVE_FLOW_CACHE, old);
      return { ...old, source: "cache", deploySlot: "active" };
    }
  }

  const staging = await readCacheFile<FlowPayload>(STAGING_FLOW_CACHE);
  if (staging?.sectors?.length) {
    return { ...staging, source: "staging", deploySlot: "staging" };
  }
  return null;
}

export async function buildFlowPayload(options?: {
  force?: boolean;
  days?: number;
}): Promise<FlowPayload> {
  if (!options?.force) {
    const active = await getActiveFlowPayload();
    if (active) return active;
  }
  return rebuildFlowPayload({ days: options?.days });
}

export async function getDeployStatus() {
  const meta = await readDeployMeta();
  return { ...meta, rebuildRunning: isRebuildRunning() };
}
