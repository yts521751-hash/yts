import type { MarketBrief, SectorFlow, StockFlow, TideStatus } from "@/lib/types";
import { SECTOR_UNIVERSE } from "@/lib/sector-universe";
import {
  fetchTpexInsti,
  fetchTpexQuotes,
  fetchTwseQuotes,
  fetchTwseT86,
  listRecentTradingDays,
  readCacheFile,
  writeCacheFile,
  type InstiRow,
  type QuoteRow,
} from "@/lib/tw-market";

const YI = 1e8;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const yi = (shares: number, price: number) =>
  !shares || !price ? 0 : (shares * price) / YI;

export type FlowPayload = {
  brief: MarketBrief;
  sectors: SectorFlow[];
  tradingDays: string[];
  source: "twse+tpex" | "cache";
  builtAt: string;
};

type DayInsti = {
  ymd: string;
  insti: Map<string, InstiRow>;
};

function statusOf(d5: number, accel: number): TideStatus {
  if (d5 >= 0 && accel >= 0) return "surge";
  if (d5 >= 0 && accel < 0) return "rotate";
  if (d5 < 0 && accel >= 0) return "watch";
  return "ebb";
}

function fearFromIndex(changePct: number): { label: string; score: number } {
  if (changePct <= -2) return { label: "恐慌", score: 88 };
  if (changePct <= -1) return { label: "偏恐慌", score: 72 };
  if (changePct < -0.3) return { label: "偏謹慎", score: 58 };
  if (changePct < 0.5) return { label: "中性", score: 48 };
  if (changePct < 1.5) return { label: "偏樂觀", score: 35 };
  return { label: "偏熱絡", score: 22 };
}

async function loadInstiDay(ymd: string): Promise<DayInsti | null> {
  const [twse, tpex] = await Promise.all([
    fetchTwseT86(ymd),
    fetchTpexInsti(ymd),
  ]);
  if (!twse && !tpex) return null;
  const insti = new Map<string, InstiRow>();
  for (const row of twse ?? []) insti.set(row.code, row);
  for (const row of tpex ?? []) {
    if (!insti.has(row.code)) insti.set(row.code, row);
  }
  return { ymd, insti };
}

async function loadQuotes(ymd: string): Promise<{
  quotes: Map<string, QuoteRow>;
  indexChangePct: number | null;
}> {
  const quotes = new Map<string, QuoteRow>();
  let indexChangePct: number | null = null;
  const twseQ = await fetchTwseQuotes(ymd);
  if (twseQ) {
    indexChangePct = twseQ.indexChangePct;
    for (const q of twseQ.quotes) quotes.set(q.code, q);
  }
  const tpexQ = await fetchTpexQuotes(ymd);
  if (tpexQ) {
    for (const q of tpexQ.quotes) {
      if (!quotes.has(q.code)) quotes.set(q.code, q);
    }
  }
  return { quotes, indexChangePct };
}

export async function buildFlowPayload(options?: {
  force?: boolean;
  days?: number;
}): Promise<FlowPayload> {
  const cacheName = "flow-latest.json";
  if (!options?.force) {
    const cached = await readCacheFile<FlowPayload & { expiresAt?: number }>(
      cacheName,
    );
    if (
      cached?.expiresAt &&
      cached.expiresAt > Date.now() &&
      cached.sectors?.length
    ) {
      return { ...cached, source: "cache" };
    }
  }

  const needDays = options?.days ?? 20;
  const tradingDays = await listRecentTradingDays(needDays, 50);
  if (tradingDays.length < 5) {
    throw new Error("無法取得足夠交易日（證交所可能維護中或尚未收盤）");
  }

  const dayData: DayInsti[] = [];
  for (const ymd of tradingDays) {
    const bundle = await loadInstiDay(ymd);
    if (bundle) dayData.push(bundle);
    await sleep(280);
  }
  if (dayData.length < 5) {
    throw new Error("法人日資料不足，請稍後再試");
  }

  const latestYmd = dayData[0].ymd;
  const oldestYmd = dayData[dayData.length - 1].ymd;
  const latestQuotes = await loadQuotes(latestYmd);
  await sleep(280);
  const oldestQuotes =
    oldestYmd === latestYmd ? latestQuotes : await loadQuotes(oldestYmd);

  const priceNow = (code: string) => latestQuotes.quotes.get(code)?.close ?? 0;
  const priceOld = (code: string) => oldestQuotes.quotes.get(code)?.close ?? 0;

  const d5Days = dayData.slice(0, Math.min(5, dayData.length));
  const d20Days = dayData.slice(0, Math.min(20, dayData.length));
  const n20 = d20Days.length;
  const latest = dayData[0];

  const sectors: SectorFlow[] = SECTOR_UNIVERSE.map((def) => {
    type Rich = StockFlow & { pxNow: number; pxOld: number };
    const stocksRich = def.members
      .map((m) => {
        const code = m.code;
        const px = priceNow(code);
        const latestInsti = latest.insti.get(code);

        let dayNet = 0;
        let foreign = 0;
        let trust = 0;
        let dealer = 0;
        if (latestInsti && px) {
          dayNet = yi(latestInsti.total, px);
          foreign = yi(latestInsti.foreign, px);
          trust = yi(latestInsti.trust, px);
          dealer = yi(latestInsti.dealer, px);
        }

        let d5 = 0;
        for (const day of d5Days) {
          const row = day.insti.get(code);
          if (row && px) d5 += yi(row.total, px);
        }

        let d20 = 0;
        for (const day of d20Days) {
          const row = day.insti.get(code);
          if (row && px) d20 += yi(row.total, px);
        }

        const pxNow = px;
        const pxOld = priceOld(code);
        const changePct = latestQuotes.quotes.get(code)?.changePct ?? 0;

        if (!latestInsti && d5 === 0 && d20 === 0 && !pxNow) return null;

        return {
          code,
          name:
            latest.insti.get(code)?.name ||
            latestQuotes.quotes.get(code)?.name ||
            m.name,
          dayNet: round1(dayNet),
          d5: round1(d5),
          d20: round1(d20),
          changePct: round2(changePct),
          foreign: round1(foreign),
          trust: round1(trust),
          dealer: round1(dealer),
          pxNow,
          pxOld,
        } satisfies Rich;
      })
      .filter(Boolean) as Rich[];

    const stocks: StockFlow[] = stocksRich
      .map(({ pxNow: _a, pxOld: _b, ...rest }) => rest)
      .sort((a, b) => b.dayNet - a.dayNet);

    const d5 = stocks.reduce((s, x) => s + x.d5, 0);
    const d20Net = stocks.reduce((s, x) => s + x.d20, 0);
    const d20Abs = stocks.reduce((s, x) => s + Math.abs(x.d20), 0);
    const avg20 = d20Net / Math.max(n20, 1);
    const avg5 = d5 / Math.max(Math.min(5, n20), 1);
    const accel = avg5 - avg20;

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
    const sectorDayNet = stocks.reduce((s, x) => s + x.dayNet, 0);
    const indexChg = latestQuotes.indexChangePct ?? 0;
    const contrarian =
      indexChg <= -1 &&
      sectorDayChange <= -0.5 &&
      sectorDayNet > 0 &&
      Math.abs(sectorDayNet) >= Math.max(0.3, Math.abs(avg20) * 1.5);

    return {
      id: def.id,
      name: def.name,
      d5: round1(d5),
      accel: round1(accel),
      d20Abs: round1(d20Abs),
      d20Net: round1(d20Net),
      priceChange20d: round2(priceChange20d),
      status: statusOf(d5, accel),
      contrarian,
      stocks,
    };
  }).filter((s) => s.stocks.length > 0);

  const indexChangePct = latestQuotes.indexChangePct ?? 0;
  const fear = fearFromIndex(indexChangePct);
  const dateIso = `${latestYmd.slice(0, 4)}-${latestYmd.slice(4, 6)}-${latestYmd.slice(6, 8)}`;

  const payload: FlowPayload = {
    brief: {
      date: dateIso,
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
  };

  await writeCacheFile(cacheName, {
    ...payload,
    expiresAt: Date.now() + 1000 * 60 * 60 * 4,
  });

  return payload;
}
