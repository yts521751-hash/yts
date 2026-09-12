import type { MarketBrief, SectorFlow, TideStatus } from "@/lib/types";
import { SECTOR_UNIVERSE } from "@/lib/sector-universe";

function statusOf(heat: number): TideStatus {
  if (heat >= 1.15) return "surge";
  if (heat >= 1.0) return "rotate";
  if (heat >= 0.85) return "watch";
  return "ebb";
}

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
  const heat = 1.35 - i * 0.04;
  const d5 = dayAmt * 4.2;
  const d20 = dayAmt * 16;
  const avg5 = d5 / 5;
  const avg20 = d20 / 20;
  const stocks = def.members.slice(0, 6).map((m, j) => ({
    code: m.code,
    name: m.name,
    dayAmt: Math.max(0.2, dayAmt / def.members.length + (3 - j)),
    d5: Math.max(1, (dayAmt / def.members.length) * 4),
    d20: Math.max(3, (dayAmt / def.members.length) * 15),
    changePct: ((j % 5) - 2) * 0.8,
  }));
  return {
    id: def.id,
    name: def.name,
    dayAmt: Math.round(dayAmt * 10) / 10,
    d5: Math.round(d5 * 10) / 10,
    accel: Math.round((avg5 - avg20) * 10) / 10,
    heat: Math.round(heat * 100) / 100,
    d20: Math.round(d20 * 10) / 10,
    priceChange20d: Math.round(((i % 7) - 3) * 1.4 * 100) / 100,
    status: statusOf(heat),
    volumeSpike: i === 2 || i === 5,
    stocks,
  };
});

export function cpScore(s: SectorFlow): number {
  if (s.d20 <= 0) return -Infinity;
  return s.d20 / Math.max(Math.abs(s.priceChange20d), 0.5);
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
  return [...sectors].sort((a, b) => b.dayAmt - a.dayAmt).slice(0, limit);
}

export function countByStatus(sectors: SectorFlow[]) {
  return {
    surge: sectors.filter((s) => s.status === "surge").length,
    rotate: sectors.filter((s) => s.status === "rotate").length,
    watch: sectors.filter((s) => s.status === "watch").length,
    ebb: sectors.filter((s) => s.status === "ebb").length,
  };
}
