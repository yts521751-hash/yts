import type {
  MarketBrief,
  SectorFlow,
  StockFlow,
  TideStatus,
} from "@/lib/types";
import { SECTOR_UNIVERSE } from "@/lib/sector-universe";
import {
  fetchTpexQuotes,
  fetchTwseQuotes,
  listRecentTradingDays,
  readCacheFile,
  writeCacheFile,
  type QuoteRow,
} from "@/lib/tw-market";

const YI = 1e8;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const toYi = (ntd: number) => ntd / YI;

export type FlowPayload = {
  brief: MarketBrief;
  sectors: SectorFlow[];
  tradingDays: string[];
  source: "twse+tpex" | "cache";
  builtAt: string;
};

type DayQuotes = {
  ymd: string;
  quotes: Map<string, QuoteRow>;
  indexChangePct: number | null;
};

function statusOf(heat: number): TideStatus {
  if (heat >= 1.15) return "surge";
  if (heat >= 1.0) return "rotate";
  if (heat >= 0.85) return "watch";
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

async function loadQuotesDay(ymd: string): Promise<DayQuotes | null> {
  const quotes = new Map<string, QuoteRow>();
  let indexChangePct: number | null = null;

  const twse = await fetchTwseQuotes(ymd);
  if (twse) {
    indexChangePct = twse.indexChangePct;
    for (const q of twse.quotes) quotes.set(q.code, q);
  }
  await sleep(200);
  const tpex = await fetchTpexQuotes(ymd);
  if (tpex) {
    for (const q of tpex.quotes) {
      if (!quotes.has(q.code)) quotes.set(q.code, q);
    }
  }

  if (quotes.size === 0) return null;
  return { ymd, quotes, indexChangePct };
}

export async function buildFlowPayload(options?: {
  force?: boolean;
  days?: number;
}): Promise<FlowPayload> {
  const cacheName = "flow-turnover-latest.json";
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

  const dayData: DayQuotes[] = [];
  for (const ymd of tradingDays) {
    const bundle = await loadQuotesDay(ymd);
    if (bundle) dayData.push(bundle);
    await sleep(280);
  }
  if (dayData.length < 5) {
    throw new Error("成交金額日資料不足，請稍後再試");
  }

  const latest = dayData[0];
  const oldest = dayData[dayData.length - 1];
  const d5Days = dayData.slice(0, Math.min(5, dayData.length));
  const d20Days = dayData.slice(0, Math.min(20, dayData.length));
  const n5 = d5Days.length;
  const n20 = d20Days.length;

  const sectors: SectorFlow[] = SECTOR_UNIVERSE.map((def) => {
    type Rich = StockFlow & { pxNow: number; pxOld: number };
    const stocksRich = def.members
      .map((m) => {
        const code = m.code;
        const latestQ = latest.quotes.get(code);
        const oldestQ = oldest.quotes.get(code);

        let dayAmt = 0;
        if (latestQ) dayAmt = toYi(latestQ.turnover);

        let d5 = 0;
        for (const day of d5Days) {
          const q = day.quotes.get(code);
          if (q) d5 += toYi(q.turnover);
        }

        let d20 = 0;
        for (const day of d20Days) {
          const q = day.quotes.get(code);
          if (q) d20 += toYi(q.turnover);
        }

        const pxNow = latestQ?.close ?? 0;
        const pxOld = oldestQ?.close ?? 0;
        const changePct = latestQ?.changePct ?? 0;

        if (dayAmt === 0 && d5 === 0 && d20 === 0 && !pxNow) return null;

        return {
          code,
          name: latestQ?.name || oldestQ?.name || m.name,
          dayAmt: round1(dayAmt),
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
      .sort((a, b) => b.dayAmt - a.dayAmt);

    const dayAmt = stocks.reduce((s, x) => s + x.dayAmt, 0);
    const d5 = stocks.reduce((s, x) => s + x.d5, 0);
    const d20 = stocks.reduce((s, x) => s + x.d20, 0);
    const avg5 = d5 / Math.max(n5, 1);
    const avg20 = d20 / Math.max(n20, 1);
    const accel = avg5 - avg20;
    const heat = avg20 > 0 ? avg5 / avg20 : avg5 > 0 ? 2 : 1;

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
      dayAmt >= Math.max(0.5, avg20 * 1.5);

    return {
      id: def.id,
      name: def.name,
      dayAmt: round1(dayAmt),
      d5: round1(d5),
      accel: round1(accel),
      heat: round2(heat),
      d20: round1(d20),
      priceChange20d: round2(priceChange20d),
      status: statusOf(heat),
      volumeSpike,
      stocks,
    };
  }).filter((s) => s.stocks.length > 0);

  const indexChangePct = latest.indexChangePct ?? 0;
  const fear = fearFromIndex(indexChangePct);
  const dateIso = `${latest.ymd.slice(0, 4)}-${latest.ymd.slice(4, 6)}-${latest.ymd.slice(6, 8)}`;

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
