/**
 * 新興題材自動發現：從熱議新聞標題＋成交熱門股，聚合成可新增的概念板塊。
 */

import { readCacheFile, writeCacheFile } from "@/lib/tw-market";
import type { SectorDef, SectorMember } from "@/lib/sector-universe";
// SectorDef.kind = "auto"

export type AutoThemePayload = {
  themes: SectorDef[];
  builtAt: string;
  source: "news+turnover";
};

const CACHE = "auto-themes.json";

/** 題材關鍵字 → 板塊名稱（可隨市場主流擴充） */
const THEME_LEXICON: { id: string; name: string; keys: string[] }[] = [
  { id: "auto-ai-server", name: "AI 伺服器", keys: ["AI伺服器", "AI 伺服器", "伺服器", "GB200", "GB300", "NVL"] },
  { id: "auto-cooling", name: "液冷散熱", keys: ["液冷", "水冷", "均熱板", "散熱模組"] },
  { id: "auto-cpo", name: "矽光子／CPO", keys: ["矽光子", "CPO", "光通訊", "光模組", "矽光"] },
  { id: "auto-robot", name: "人形機器人", keys: ["人形機器人", "機器人", "Harmonic", "減速機"] },
  { id: "auto-satcom", name: "低軌衛星", keys: ["低軌衛星", "衛星通訊", "Starlink", "發射"] },
  { id: "auto-energy", name: "儲能／電力", keys: ["儲能", "電網", "變壓器", "電力設備", "固態電池"] },
  { id: "auto-defense", name: "軍工防衛", keys: ["軍工", "國防", "無人機", "飛彈"] },
  { id: "auto-pcb", name: "ABF／載板", keys: ["ABF", "載板", "IC載板", "高階PCB"] },
  { id: "auto-memory", name: "HBM／記憶體", keys: ["HBM", "記憶體", "DRAM", "DDR5"] },
  { id: "auto-ev", name: "電動車", keys: ["電動車", "充電樁", "車用電子", "Tesla"] },
];

function uniqMembers(list: SectorMember[]): SectorMember[] {
  const seen = new Set<string>();
  const out: SectorMember[] = [];
  for (const m of list) {
    if (seen.has(m.code)) continue;
    seen.add(m.code);
    out.push(m);
  }
  return out;
}

export async function discoverAutoThemes(input: {
  newsTitles: string[];
  hotStocks: SectorMember[];
}): Promise<AutoThemePayload> {
  const hot = input.hotStocks.slice(0, 80);
  const blob = input.newsTitles.join("\n");

  const themes: SectorDef[] = [];
  for (const theme of THEME_LEXICON) {
    const hitNews = theme.keys.some((k) => blob.includes(k));
    if (!hitNews) continue;

    // 新聞有題材時，把成交熱門股中名稱／後續可擴成關鍵字對應的候選放進來
    // 先用「熱門股全部暫列、再依新聞共現過濾」：標題同時含題材字與股名才收錄
    const members: SectorMember[] = [];
    for (const s of hot) {
      const name = s.name.replace(/\s+/g, "");
      const related = input.newsTitles.some(
        (t) =>
          theme.keys.some((k) => t.includes(k)) &&
          (t.includes(name) || t.includes(s.code)),
      );
      if (related) members.push(s);
    }

    // 若共現不足，仍建立板塊殼，成分先放成交最熱的少數（稍後有新聞共現會變準）
    const finalMembers = uniqMembers(
      members.length >= 3 ? members : hot.slice(0, 6),
    ).slice(0, 12);

    if (finalMembers.length < 3) continue;
    themes.push({
      id: theme.id,
      name: `新興・${theme.name}`,
      basis: "依熱議新聞題材自動聚合（可隨主流題材新增）",
      kind: "auto",
      members: finalMembers,
    });
  }

  const payload: AutoThemePayload = {
    themes,
    builtAt: new Date().toISOString(),
    source: "news+turnover",
  };
  await writeCacheFile(CACHE, payload);
  return payload;
}

export async function loadAutoThemes(): Promise<SectorDef[]> {
  const cached = await readCacheFile<AutoThemePayload>(CACHE);
  return cached?.themes ?? [];
}
