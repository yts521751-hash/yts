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
import { isCommonStock } from "@/lib/stock-filter";
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
  /** 最新交易日群組成交值占上市櫃普通股成交值的比例（%） */
  turnoverSharePct: number;
  /** 當日占比 − 截至當日近 20 日平均占比（百分點） */
  dayShareDeltaPp: number;
  /** 最近 3 個交易日每日 pp 偏離的平均 */
  d3ShareDeltaPp: number;
  /** 最近 5 個交易日每日 pp 偏離的平均 */
  d5ShareDeltaPp: number;
  /** 最新日為止近 20 日群組成交占比平均（%） */
  avg20TurnoverSharePct: number;
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

function avg(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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
  // 分母一定從每日完整上市櫃報價檔計算，而非從任何題材成分表推回，
  // 所以跨題材標籤不會重複放大整體市場成交值。
  const marketTurnovers = dayData.map((day) =>
    [...day.quotes.values()]
      .filter((quote) => isCommonStock(quote.code, quote.name))
      .reduce((sum, quote) => sum + Math.max(0, quote.turnover), 0),
  );

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

      const dailyShares = dayData.map((day, index) => {
        const groupTurnover = def.members.reduce((sum, member) => {
          const quote = day.quotes.get(member.code);
          return sum + (quote && isCommonStock(quote.code, quote.name)
            ? Math.max(0, quote.turnover)
            : 0);
        }, 0);
        const marketTurnover = marketTurnovers[index] ?? 0;
        return marketTurnover > 0 ? (groupTurnover / marketTurnover) * 100 : 0;
      });
      const dailyShareDeltas = dailyShares.map((share, index) =>
        share - avg(dailyShares.slice(index, index + 20)),
      );
      const dayShareDeltaPp = dailyShareDeltas[0] ?? 0;
      const d3ShareDeltaPp = avg(dailyShareDeltas.slice(0, 3));
      const d5ShareDeltaPp = avg(dailyShareDeltas.slice(0, 5));
      const turnoverSharePct = dailyShares[0] ?? 0;
      const avg20TurnoverSharePct = avg(dailyShares.slice(0, 20));

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
        turnoverSharePct: round2(turnoverSharePct),
        dayShareDeltaPp: round2(dayShareDeltaPp),
        d3ShareDeltaPp: round2(d3ShareDeltaPp),
        d5ShareDeltaPp: round2(d5ShareDeltaPp),
        avg20TurnoverSharePct: round2(avg20TurnoverSharePct),
        fullRollup: kind === "industry",
      } satisfies IndustryFlowRow;
    })
    .filter(Boolean) as IndustryFlowRow[];
}
