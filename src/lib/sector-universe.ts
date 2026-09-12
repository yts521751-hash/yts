/** 題材板塊成分（以潮汐式題材分類為靈感，成分為真實上市櫃代號） */
export type SectorMember = { code: string; name: string };

export type SectorDef = {
  id: string;
  name: string;
  members: SectorMember[];
};

export const SECTOR_UNIVERSE: SectorDef[] = [
  {
    id: "ai-server",
    name: "AI 伺服器組裝",
    members: [
      { code: "6669", name: "緯穎" },
      { code: "3231", name: "緯創" },
      { code: "2356", name: "英業達" },
      { code: "2376", name: "技嘉" },
      { code: "2382", name: "廣達" },
      { code: "3017", name: "奇鋐" },
      { code: "2324", name: "仁寶" },
      { code: "2353", name: "宏碁" },
    ],
  },
  {
    id: "liquid-cooling",
    name: "液冷散熱",
    members: [
      { code: "3017", name: "奇鋐" },
      { code: "3324", name: "雙鴻" },
      { code: "6235", name: "華孚" },
      { code: "2421", name: "建準" },
      { code: "3653", name: "健策" },
      { code: "2465", name: "麗臺" },
    ],
  },
  {
    id: "ems",
    name: "EMS 電子代工",
    members: [
      { code: "2317", name: "鴻海" },
      { code: "4938", name: "和碩" },
      { code: "2356", name: "英業達" },
      { code: "3231", name: "緯創" },
      { code: "2382", name: "廣達" },
      { code: "2357", name: "華碩" },
    ],
  },
  {
    id: "pcb",
    name: "PCB 載板",
    members: [
      { code: "3037", name: "欣興" },
      { code: "8046", name: "南電" },
      { code: "2368", name: "金像電" },
      { code: "3189", name: "景碩" },
      { code: "2313", name: "華通" },
      { code: "2355", name: "敬鵬" },
    ],
  },
  {
    id: "foundry",
    name: "晶圓代工",
    members: [
      { code: "2330", name: "台積電" },
      { code: "2303", name: "聯電" },
      { code: "3711", name: "日月光投控" },
      { code: "6770", name: "力積電" },
    ],
  },
  {
    id: "advanced-packaging",
    name: "AI 先進封裝",
    members: [
      { code: "3711", name: "日月光投控" },
      { code: "6239", name: "力成" },
      { code: "2449", name: "京元電子" },
      { code: "3374", name: "精材" },
      { code: "3532", name: "台勝科" },
    ],
  },
  {
    id: "hbm-memory",
    name: "HBM／記憶體",
    members: [
      { code: "2408", name: "南亞科" },
      { code: "2344", name: "華邦電" },
      { code: "8299", name: "群聯" },
      { code: "2451", name: "創見" },
      { code: "3260", name: "威剛" },
    ],
  },
  {
    id: "ic-design",
    name: "IC 設計",
    members: [
      { code: "2454", name: "聯發科" },
      { code: "3034", name: "聯詠" },
      { code: "2379", name: "瑞昱" },
      { code: "4966", name: "譜瑞-KY" },
      { code: "3443", name: "創意" },
      { code: "5274", name: "信驊" },
      { code: "3661", name: "世芯-KY" },
      { code: "6415", name: "矽力*-KY" },
    ],
  },
  {
    id: "semiconductor-equipment",
    name: "半導體設備材料",
    members: [
      { code: "3532", name: "台勝科" },
      { code: "3131", name: "弘塑" },
      { code: "3583", name: "辛耘" },
      { code: "6182", name: "合晶" },
      { code: "5483", name: "中美晶" },
      { code: "3016", name: "嘉晶" },
    ],
  },
  {
    id: "smartphone",
    name: "智慧型手機",
    members: [
      { code: "2317", name: "鴻海" },
      { code: "2474", name: "可成" },
      { code: "3008", name: "大立光" },
      { code: "3406", name: "玉晶光" },
      { code: "2354", name: "鴻準" },
      { code: "2385", name: "群光" },
    ],
  },
  {
    id: "power-inductor",
    name: "功率電感／被動",
    members: [
      { code: "2456", name: "奇力新" },
      { code: "2327", name: "國巨" },
      { code: "2492", name: "華新科" },
      { code: "2308", name: "台達電" },
      { code: "6176", name: "瑞儀" },
    ],
  },
  {
    id: "networking",
    name: "網通與交換器",
    members: [
      { code: "2345", name: "智邦" },
      { code: "3706", name: "神基" },
      { code: "3596", name: "智易" },
      { code: "6285", name: "啟碁" },
      { code: "4904", name: "遠傳" },
      { code: "2412", name: "中華電" },
    ],
  },
  {
    id: "optical",
    name: "光通訊／矽光子",
    members: [
      { code: "3363", name: "上詮" },
      { code: "4977", name: "眾達-KY" },
      { code: "6451", name: "訊芯-KY" },
      { code: "4979", name: "華星光" },
      { code: "3081", name: "聯亞" },
    ],
  },
  {
    id: "shipping",
    name: "航運",
    members: [
      { code: "2603", name: "長榮" },
      { code: "2609", name: "陽明" },
      { code: "2615", name: "萬海" },
      { code: "2606", name: "裕民" },
      { code: "2637", name: "慧洋-KY" },
    ],
  },
  {
    id: "financials",
    name: "金融控股",
    members: [
      { code: "2881", name: "富邦金" },
      { code: "2882", name: "國泰金" },
      { code: "2891", name: "中信金" },
      { code: "2886", name: "兆豐金" },
      { code: "2884", name: "玉山金" },
      { code: "2880", name: "華南金" },
    ],
  },
  {
    id: "biotech",
    name: "生技醫藥",
    members: [
      { code: "4743", name: "合一" },
      { code: "6541", name: "泰福-KY" },
      { code: "1795", name: "美時" },
      { code: "4162", name: "智擎" },
      { code: "6472", name: "保瑞" },
    ],
  },
  {
    id: "green-energy",
    name: "綠能與儲能",
    members: [
      { code: "6869", name: "雲豹能源" },
      { code: "6443", name: "元晶" },
      { code: "3576", name: "聯合再生" },
      { code: "1513", name: "中興電" },
      { code: "1605", name: "華新" },
    ],
  },
  {
    id: "auto-electronics",
    name: "車用電子",
    members: [
      { code: "2231", name: "為升" },
      { code: "6271", name: "同欣電" },
      { code: "2392", name: "正崴" },
      { code: "8255", name: "朋程" },
      { code: "2247", name: "宏旭-KY" },
    ],
  },
  {
    id: "panel",
    name: "面板與光學",
    members: [
      { code: "3481", name: "群創" },
      { code: "2409", name: "友達" },
      { code: "3008", name: "大立光" },
      { code: "3406", name: "玉晶光" },
      { code: "4935", name: "茂林-KY" },
    ],
  },
  {
    id: "defense",
    name: "軍工航太",
    members: [
      { code: "2634", name: "漢翔" },
      { code: "2208", name: "台船" },
      { code: "4572", name: "駐波" },
      { code: "8038", name: "長園科" },
    ],
  },
];

export function allUniverseCodes(): string[] {
  const set = new Set<string>();
  for (const s of SECTOR_UNIVERSE) {
    for (const m of s.members) set.add(m.code);
  }
  return [...set];
}
