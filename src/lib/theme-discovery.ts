/**
 * 新興題材自動發現：從熱議新聞標題＋成交熱門股，聚合成可新增的概念板塊。
 */

import { readCacheFile, writeCacheFile } from "@/lib/tw-market";
import type { SectorDef, SectorMember } from "@/lib/sector-universe";

export type AutoThemePayload = {
  themes: SectorDef[];
  builtAt: string;
  source: "news+turnover";
};

const CACHE = "auto-themes.json";

/** 題材關鍵字 → 板塊名稱（可隨市場主流擴充） */
const THEME_LEXICON: {
  id: string;
  name: string;
  keys: string[];
  /** 題材種子成分（避免新聞共現不足時各板塊共用同一組熱門股） */
  seeds: SectorMember[];
}[] = [
  {
    id: "auto-ai-server",
    name: "AI 伺服器",
    keys: ["AI伺服器", "AI 伺服器", "伺服器", "GB200", "GB300", "NVL"],
    seeds: [
      { code: "6669", name: "緯穎" },
      { code: "2382", name: "廣達" },
      { code: "3231", name: "緯創" },
      { code: "2356", name: "英業達" },
      { code: "2376", name: "技嘉" },
      { code: "2324", name: "仁寶" },
      { code: "3017", name: "奇鋐" },
      { code: "6414", name: "樺漢" },
    ],
  },
  {
    id: "auto-cooling",
    name: "液冷散熱",
    keys: ["液冷", "水冷", "均熱板", "散熱模組"],
    seeds: [
      { code: "3017", name: "奇鋐" },
      { code: "3324", name: "雙鴻" },
      { code: "6235", name: "華孚" },
      { code: "2421", name: "建準" },
      { code: "3653", name: "健策" },
      { code: "3483", name: "力致" },
      { code: "8255", name: "朋程" },
    ],
  },
  {
    id: "auto-cpo",
    name: "矽光子／CPO",
    keys: ["矽光子", "CPO", "光通訊", "光模組", "矽光"],
    seeds: [
      { code: "3363", name: "上詮" },
      { code: "4977", name: "眾達-KY" },
      { code: "6451", name: "訊芯-KY" },
      { code: "4979", name: "華星光" },
      { code: "3081", name: "聯亞" },
      { code: "6442", name: "光聖" },
      { code: "3037", name: "欣興" },
    ],
  },
  {
    id: "auto-robot",
    name: "人形機器人",
    keys: ["人形機器人", "機器人", "Harmonic", "減速機"],
    seeds: [
      { code: "1590", name: "亞德客-KY" },
      { code: "2049", name: "上銀" },
      { code: "4576", name: "大眾控" },
      { code: "2395", name: "研華" },
      { code: "2464", name: "盟立" },
      { code: "4540", name: "全球傳動" },
    ],
  },
  {
    id: "auto-satcom",
    name: "低軌衛星",
    keys: ["低軌衛星", "衛星通訊", "Starlink", "發射"],
    seeds: [
      { code: "3491", name: "昇達科" },
      { code: "6285", name: "啟碁" },
      { code: "5388", name: "中磊" },
      { code: "4904", name: "遠傳" },
      { code: "2412", name: "中華電" },
      { code: "2634", name: "漢翔" },
    ],
  },
  {
    id: "auto-energy",
    name: "儲能／電力",
    keys: ["儲能", "電網", "變壓器", "電力設備", "固態電池"],
    seeds: [
      { code: "1513", name: "中興電" },
      { code: "1519", name: "華城" },
      { code: "1504", name: "東元" },
      { code: "6869", name: "雲豹能源" },
      { code: "1605", name: "華新" },
      { code: "6781", name: "AES-KY" },
    ],
  },
  {
    id: "auto-defense",
    name: "軍工防衛",
    keys: ["軍工", "國防", "無人機", "飛彈"],
    seeds: [
      { code: "2634", name: "漢翔" },
      { code: "2208", name: "台船" },
      { code: "4572", name: "駐波" },
      { code: "8038", name: "長園科" },
      { code: "3023", name: "信邦" },
      { code: "2464", name: "盟立" },
    ],
  },
  {
    id: "auto-pcb",
    name: "ABF／載板",
    keys: ["ABF", "載板", "IC載板", "高階PCB"],
    seeds: [
      { code: "3037", name: "欣興" },
      { code: "8046", name: "南電" },
      { code: "3189", name: "景碩" },
      { code: "2368", name: "金像電" },
      { code: "2313", name: "華通" },
      { code: "4958", name: "臻鼎-KY" },
    ],
  },
  {
    id: "auto-memory",
    name: "HBM／記憶體",
    keys: ["HBM", "記憶體", "DRAM", "DDR5"],
    seeds: [
      { code: "2408", name: "南亞科" },
      { code: "2344", name: "華邦電" },
      { code: "8299", name: "群聯" },
      { code: "3260", name: "威剛" },
      { code: "4967", name: "十銓" },
      { code: "2451", name: "創見" },
    ],
  },
  {
    id: "auto-ev",
    name: "電動車",
    keys: ["電動車", "充電樁", "車用電子", "Tesla"],
    seeds: [
      { code: "2231", name: "為升" },
      { code: "6271", name: "同欣電" },
      { code: "8255", name: "朋程" },
      { code: "2308", name: "台達電" },
      { code: "2392", name: "正崴" },
      { code: "2247", name: "宏旭-KY" },
    ],
  },
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

/** 種子優先對齊當日熱門成交，再補齊其餘種子 */
function membersFromSeeds(
  seeds: SectorMember[],
  hot: SectorMember[],
): SectorMember[] {
  const hotRank = new Map(hot.map((s, i) => [s.code, i]));
  const named = new Map(hot.map((s) => [s.code, s.name]));
  return [...seeds]
    .map((s) => ({
      code: s.code,
      name: named.get(s.code) || s.name,
      rank: hotRank.get(s.code) ?? 10_000,
    }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ code, name }) => ({ code, name }));
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

    // 標題同時含題材字與股名／代號才收錄
    const fromNews: SectorMember[] = [];
    for (const s of hot) {
      const name = s.name.replace(/\s+/g, "");
      const related = input.newsTitles.some(
        (t) =>
          theme.keys.some((k) => t.includes(k)) &&
          (t.includes(name) || t.includes(s.code)),
      );
      if (related) fromNews.push(s);
    }

    const seeded = membersFromSeeds(theme.seeds, hot);
    // 種子優先（確保各新興板塊成分不同），再併入新聞共現；絕不用全市場同一組熱門股當 fallback
    const finalMembers = uniqMembers([...seeded, ...fromNews]).slice(0, 12);

    if (finalMembers.length < 3) continue;
    themes.push({
      id: theme.id,
      name: `新興・${theme.name}`,
      basis: "依熱議新聞題材自動聚合（成分以新聞共現＋題材種子為主）",
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
