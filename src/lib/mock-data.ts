import type { MarketBrief, SectorFlow, TideStatus } from "@/lib/types";
import { SECTOR_UNIVERSE } from "@/lib/sector-universe";
import { statusFromFlow } from "@/lib/money-flow";

export const MARKET_BRIEF: MarketBrief = {
  date: "2026-09-11",
  indexChangePct: -1.24,
  fearLabel: "偏恐慌",
  fearScore: 72,
  updatedAt: "2026-09-11 18:05",
  isDemo: true,
};

export const SECTORS: SectorFlow[] = SECTOR_UNIVERSE.map((def, i) => {
  const dayAmt = 80 - i * 3.2 + (i % 3) * 5;
  const dayFlow = (i % 2 === 0 ? 1 : -1) * (12 - i * 0.45);
  const dayIn = Math.max(0, dayFlow) + dayAmt * 0.12;
  const dayOut = Math.max(0, -dayFlow) + dayAmt * 0.08;
  const d3Flow = dayFlow * 2.6;
  const d5Flow = dayFlow * 4.2;
  const d20Flow = dayFlow * 14;
  const accel = d5Flow / 5 - d20Flow / 20;
  const d3 = dayAmt * 2.6;
  const d5 = dayAmt * 4.2;
  const d20 = dayAmt * 16;
  const heat = 1.25 - i * 0.035;
  const stocks = def.members.slice(0, 6).map((m, j) => {
    const changePct = ((j % 5) - 2) * 0.8;
    const amt = Math.max(0.2, dayAmt / def.members.length + (3 - j));
    const flow = amt * Math.tanh(changePct / 2.5);
    return {
      code: m.code,
      name: m.name,
      dayAmt: Math.round(amt * 10) / 10,
      dayFlow: Math.round(flow * 10) / 10,
      dayIn: Math.round(Math.max(0, flow) * 10) / 10,
      dayOut: Math.round(Math.max(0, -flow) * 10) / 10,
      d3Flow: Math.round(flow * 2.5 * 10) / 10,
      d5Flow: Math.round(flow * 4 * 10) / 10,
      d20Flow: Math.round(flow * 15 * 10) / 10,
      d3: Math.max(0.5, amt * 2.5),
      d5: Math.max(1, amt * 4),
      d20: Math.max(3, amt * 15),
      changePct,
    };
  });
  return {
    id: def.id,
    name: def.name,
    dayAmt: Math.round(dayAmt * 10) / 10,
    dayFlow: Math.round(dayFlow * 10) / 10,
    dayIn: Math.round(dayIn * 10) / 10,
    dayOut: Math.round(dayOut * 10) / 10,
    d3Flow: Math.round(d3Flow * 10) / 10,
    d5Flow: Math.round(d5Flow * 10) / 10,
    d20Flow: Math.round(d20Flow * 10) / 10,
    d3: Math.round(d3 * 10) / 10,
    d5: Math.round(d5 * 10) / 10,
    d20: Math.round(d20 * 10) / 10,
    accel: Math.round(accel * 10) / 10,
    heat: Math.round(heat * 100) / 100,
    priceChange20d: Math.round(((i % 7) - 3) * 1.4 * 100) / 100,
    status: statusFromFlow(d5Flow, accel),
    volumeSpike: i === 2 || i === 5,
    stocks,
  };
});

/** 舊快取缺欄位時補預設，避免 UI 炸掉 */
export function migrateSectorIfNeeded(s: SectorFlow): SectorFlow {
  const dayFlow = s.dayFlow ?? 0;
  const d3Flow = s.d3Flow ?? (s.d5Flow ?? 0) * 0.6;
  const d5Flow = s.d5Flow ?? 0;
  const d20Flow = s.d20Flow ?? 0;
  const accel = s.accel ?? d5Flow / 5 - d20Flow / 20;
  return {
    ...s,
    dayFlow,
    dayIn: s.dayIn ?? Math.max(0, dayFlow),
    dayOut: s.dayOut ?? Math.max(0, -dayFlow),
    d3Flow,
    d5Flow,
    d20Flow,
    d3: s.d3 ?? (s.d5 ?? 0) * 0.6,
    d5: s.d5 ?? 0,
    d20: s.d20 ?? 0,
    accel,
    heat: s.heat ?? 1,
    status: s.status ?? statusFromFlow(d5Flow, accel),
    stocks: (s.stocks ?? []).map((st) => ({
      ...st,
      dayFlow: st.dayFlow ?? 0,
      dayIn: st.dayIn ?? Math.max(0, st.dayFlow ?? 0),
      dayOut: st.dayOut ?? Math.max(0, -(st.dayFlow ?? 0)),
      d3Flow: st.d3Flow ?? (st.d5Flow ?? 0) * 0.6,
      d5Flow: st.d5Flow ?? 0,
      d20Flow: st.d20Flow ?? 0,
      d3: st.d3 ?? (st.d5 ?? 0) * 0.6,
      d5: st.d5 ?? 0,
      d20: st.d20 ?? 0,
    })),
  };
}

/** CP：成交大、漲幅溫和，並略偏好淨流入 */
export function cpScore(s: SectorFlow): number {
  if (s.d20 <= 0) return -Infinity;
  const bonus = s.d20Flow > 0 ? 1.15 : 0.85;
  return (s.d20 / Math.max(Math.abs(s.priceChange20d), 0.5)) * bonus;
}

export function getCpRanking(sectors: SectorFlow[], limit = 8): SectorFlow[] {
  return [...sectors]
    .filter((s) => s.d20 > 0)
    .sort((a, b) => cpScore(b) - cpScore(a))
    .slice(0, limit);
}

export function getContrarianSectors(sectors: SectorFlow[]): SectorFlow[] {
  return sectors
    .filter((s) => s.volumeSpike)
    .sort((a, b) => b.dayAmt - a.dayAmt);
}

export function getTopBuySectors(sectors: SectorFlow[], limit = 5): SectorFlow[] {
  return [...sectors].sort((a, b) => b.dayFlow - a.dayFlow).slice(0, limit);
}

export function countByStatus(sectors: SectorFlow[]) {
  return {
    surge: sectors.filter((s) => s.status === "surge").length,
    rotate: sectors.filter((s) => s.status === "rotate").length,
    watch: sectors.filter((s) => s.status === "watch").length,
    ebb: sectors.filter((s) => s.status === "ebb").length,
  };
}

export type { TideStatus };
