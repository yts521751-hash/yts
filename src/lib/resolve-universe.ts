/**
 * 組出「官方產業 + 題材 + 自動新興題材」的有效板塊清單。
 */

import { industrySectorId, loadIndustryMap } from "@/lib/industry-map";
import {
  SECTOR_UNIVERSE,
  type SectorDef,
  type SectorMember,
} from "@/lib/sector-universe";
import { discoverAutoThemes, loadAutoThemes } from "@/lib/theme-discovery";
import type { QuoteRow } from "@/lib/tw-market";

const THEME_WITH_KIND: SectorDef[] = SECTOR_UNIVERSE.map((s) => ({
  ...s,
  kind: s.kind ?? ("theme" as const),
}));

function topMembersByTurnover(
  codes: string[],
  nameByCode: Map<string, string>,
  quotes: Map<string, QuoteRow>,
  limit: number,
): SectorMember[] {
  return codes
    .map((code) => {
      const q = quotes.get(code);
      return {
        code,
        name: nameByCode.get(code) || q?.name || code,
        turnover: q?.turnover ?? 0,
      };
    })
    .filter((x) => x.turnover > 0)
    .sort((a, b) => b.turnover - a.turnover)
    .slice(0, limit)
    .map(({ code, name }) => ({ code, name }));
}

/** 依當日成交，把官方產業收成可讀的核心觀察名單 */
export async function buildIndustrySectors(
  quotes: Map<string, QuoteRow>,
): Promise<SectorDef[]> {
  const map = await loadIndustryMap().catch(() => null);
  if (!map?.stocks?.length) return [];

  type Bucket = { codes: string[]; names: Map<string, string> };
  const byIndustry = new Map<string, Bucket>();

  for (const s of map.stocks) {
    let bucket = byIndustry.get(s.industry);
    if (!bucket) {
      bucket = { codes: [], names: new Map() };
      byIndustry.set(s.industry, bucket);
    }
    bucket.codes.push(s.code);
    bucket.names.set(s.code, s.name);
  }

  const sectors: SectorDef[] = [];
  for (const [industry, bucket] of byIndustry) {
    const members = topMembersByTurnover(
      bucket.codes,
      bucket.names,
      quotes,
      12,
    );
    if (members.length < 4) continue;
    if ((industry === "其他" || industry === "其他業") && members.length < 8) {
      continue;
    }
    sectors.push({
      id: industrySectorId(industry),
      name: industry,
      basis: "依證交所／櫃買 ISIN 官方產業別（接近三竹產業類型），取當日成交較熱的代表性個股",
      kind: "industry",
      members,
    });
  }

  return sectors.sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
}

export async function resolveActiveUniverse(input: {
  quotes: Map<string, QuoteRow>;
  newsTitles?: string[];
}): Promise<SectorDef[]> {
  const industry = await buildIndustrySectors(input.quotes);
  const themes = THEME_WITH_KIND;

  let auto = await loadAutoThemes();
  if (input.newsTitles?.length) {
    const hot: SectorMember[] = [...input.quotes.values()]
      .filter((q) => /^\d{4}$/.test(q.code) && q.turnover > 0)
      .sort((a, b) => b.turnover - a.turnover)
      .slice(0, 80)
      .map((q) => ({ code: q.code, name: q.name }));
    try {
      const discovered = await discoverAutoThemes({
        newsTitles: input.newsTitles,
        hotStocks: hot,
      });
      auto = discovered.themes;
    } catch {
      /* keep previous */
    }
  }

  const seen = new Set<string>();
  const out: SectorDef[] = [];
  for (const s of [...industry, ...themes, ...auto]) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push({ ...s, kind: s.kind ?? "theme" });
  }
  return out;
}

export function watchCodesFromUniverse(sectors: SectorDef[]): Set<string> {
  return new Set(sectors.flatMap((s) => s.members.map((m) => m.code)));
}
