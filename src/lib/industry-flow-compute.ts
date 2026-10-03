/**
 * 產業流純聚合（無 server-only／I/O），供 build-industry-flow 與單測共用。
 */

import {
  blendFlow,
  instiSharesToYi,
  signedFlowFromQuote,
  statusFromFlow,
} from "@/lib/money-flow";
import {
  industryMegaGroup,
  type IndustryMegaGroup,
} from "@/lib/industry-taxonomy";
import type { SectorDef } from "@/lib/sector-universe";
import type { SectorFlow, StockFlow, TideStatus } from "@/lib/types";
import type { InstiRow, QuoteRow } from "@/lib/tw-market";

const TOP_STOCKS = 12;
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

export type IndustryFlowRow = SectorFlow & {
  megaGroup: IndustryMegaGroup | null;
  memberCount: number;
  dayInstiYi: number;
  d3InstiYi: number;
  d5InstiYi: number;
  fullRollup: boolean;
};

export type IndustryFlowDayBundle = {
  ymd: string;
  quotes: Map<string, QuoteRow>;
  insti: Map<string, InstiRow>;
  indexChangePct: number | null;
};

function flowForCode(day: IndustryFlowDayBundle, code: string) {
  const q = day.quotes.get(code);
  if (!q) return null;
  const price = signedFlowFromQuote(q.turnover, q.changePct);
  const row = day.insti.get(code);
  const instiYi =
    row && q.close > 0 ? instiSharesToYi(row.total, q.close) : null;
  return { parts: blendFlow(price, instiYi), instiYi: instiYi ?? 0 };
}

/** 全成分加總產業／題材混合金流 */
export function computeIndustryFlowRows(
  dayData: IndustryFlowDayBundle[],
  universe: SectorDef[],
): IndustryFlowRow[] {
  if (!dayData.length) return [];
  const latest = dayData[0];
  const oldest = dayData[dayData.length - 1];
  const d3Days = dayData.slice(0, Math.min(3, dayData.length));
  const d5Days = dayData.slice(0, Math.min(5, dayData.length));
  const d20Days = dayData.slice(0, Math.min(20, dayData.length));
  const n5 = d5Days.length;
  const n20 = d20Days.length;

  return universe
    .map((def) => {
      type Rich = StockFlow & {
        pxNow: number;
        pxOld: number;
        dayInstiYi: number;
        d3InstiYi: number;
        d5InstiYi: number;
      };

      const stocksRich: Rich[] = [];
      for (const m of def.members) {
        const code = m.code;
        const latestQ = latest.quotes.get(code);
        const oldestQ = oldest.quotes.get(code);
        const everQuoted = dayData.some((d) => d.quotes.has(code));
        if (!everQuoted && def.kind === "industry") continue;

        let dayAmt = 0;
        let dayFlow = 0;
        let dayIn = 0;
        let dayOut = 0;
        let dayInstiYi = 0;
        const dayParts = flowForCode(latest, code);
        if (dayParts) {
          dayAmt = dayParts.parts.amt;
          dayFlow = dayParts.parts.flow;
          dayIn = dayParts.parts.inflow;
          dayOut = dayParts.parts.outflow;
          dayInstiYi = dayParts.instiYi;
        }

        let d3 = 0;
        let d3Flow = 0;
        let d3InstiYi = 0;
        for (const day of d3Days) {
          const p = flowForCode(day, code);
          if (!p) continue;
          d3 += p.parts.amt;
          d3Flow += p.parts.flow;
          d3InstiYi += p.instiYi;
        }

        let d5 = 0;
        let d5Flow = 0;
        let d5InstiYi = 0;
        for (const day of d5Days) {
          const p = flowForCode(day, code);
          if (!p) continue;
          d5 += p.parts.amt;
          d5Flow += p.parts.flow;
          d5InstiYi += p.instiYi;
        }

        let d20 = 0;
        let d20Flow = 0;
        for (const day of d20Days) {
          const p = flowForCode(day, code);
          if (!p) continue;
          d20 += p.parts.amt;
          d20Flow += p.parts.flow;
        }

        stocksRich.push({
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
          close: round2(latestQ?.close ?? 0),
          pxNow: latestQ?.close ?? 0,
          pxOld: oldestQ?.close ?? 0,
          dayInstiYi: round1(dayInstiYi),
          d3InstiYi: round1(d3InstiYi),
          d5InstiYi: round1(d5InstiYi),
        });
      }

      if (!stocksRich.length) return null;

      const dayAmt = stocksRich.reduce((s, x) => s + x.dayAmt, 0);
      const dayFlow = stocksRich.reduce((s, x) => s + x.dayFlow, 0);
      const dayIn = stocksRich.reduce((s, x) => s + x.dayIn, 0);
      const dayOut = stocksRich.reduce((s, x) => s + x.dayOut, 0);
      const d3 = stocksRich.reduce((s, x) => s + x.d3, 0);
      const d5 = stocksRich.reduce((s, x) => s + x.d5, 0);
      const d20 = stocksRich.reduce((s, x) => s + x.d20, 0);
      const d3Flow = stocksRich.reduce((s, x) => s + x.d3Flow, 0);
      const d5Flow = stocksRich.reduce((s, x) => s + x.d5Flow, 0);
      const d20Flow = stocksRich.reduce((s, x) => s + x.d20Flow, 0);
      const dayInstiYi = stocksRich.reduce((s, x) => s + x.dayInstiYi, 0);
      const d3InstiYi = stocksRich.reduce((s, x) => s + x.d3InstiYi, 0);
      const d5InstiYi = stocksRich.reduce((s, x) => s + x.d5InstiYi, 0);

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
        stocksRich.length > 0
          ? stocksRich.reduce((s, x) => s + x.changePct, 0) / stocksRich.length
          : 0;
      const indexChg = latest.indexChangePct ?? 0;
      const volumeSpike =
        indexChg <= -1 &&
        sectorDayChange <= -0.5 &&
        dayAmt >= Math.max(0.5, avg20Amt * 1.5);

      const status: TideStatus = statusFromFlow(d5Flow, accel);
      const kind = def.kind ?? "theme";
      const stocks: StockFlow[] = [...stocksRich]
        .sort((a, b) => Math.abs(b.dayFlow) - Math.abs(a.dayFlow))
        .slice(0, TOP_STOCKS)
        .map(
          ({
            pxNow: _a,
            pxOld: _b,
            dayInstiYi: _c,
            d3InstiYi: _d,
            d5InstiYi: _e,
            ...rest
          }) => rest,
        )
        .sort((a, b) => b.dayFlow - a.dayFlow);

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
        kind,
        megaGroup: kind === "industry" ? industryMegaGroup(def.name) : null,
        memberCount: def.members.length,
        dayInstiYi: round1(dayInstiYi),
        d3InstiYi: round1(d3InstiYi),
        d5InstiYi: round1(d5InstiYi),
        fullRollup: kind === "industry",
      } satisfies IndustryFlowRow;
    })
    .filter(Boolean) as IndustryFlowRow[];
}
