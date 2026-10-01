/**
 * 美股流動標的：英文全名＋簡短中文名。
 * 未收錄者以 Yahoo／Nasdaq 英文名為主，中文回退音譯／簡稱。
 */

/** 精選流動股中文短名（成值／排行用） */
export const US_NAME_ZH: Record<string, string> = {
  AAPL: "蘋果",
  MSFT: "微軟",
  NVDA: "輝達",
  AVGO: "博通",
  ORCL: "甲骨文",
  CRM: "賽富時",
  AMD: "超微",
  ADBE: "奧多比",
  CSCO: "思科",
  INTC: "英特爾",
  QCOM: "高通",
  TXN: "德州儀器",
  NOW: "ServiceNow",
  INTU: "Intuit",
  AMAT: "應用材料",
  GOOGL: "Alphabet A",
  GOOG: "Alphabet C",
  META: "Meta／臉書",
  NFLX: "網飛",
  DIS: "迪士尼",
  CMCSA: "康卡斯特",
  T: "AT&T",
  VZ: "威瑞森",
  TMUS: "T-Mobile",
  AMZN: "亞馬遜",
  TSLA: "特斯拉",
  HD: "家得寶",
  MCD: "麥當勞",
  NKE: "耐克",
  SBUX: "星巴克",
  LOW: "勞氏",
  BKNG: "Booking",
  TJX: "TJX",
  CMG: "Chipotle",
  WMT: "沃爾瑪",
  PG: "寶僑",
  KO: "可口可樂",
  PEP: "百事",
  COST: "好市多",
  PM: "菲利普莫里斯",
  MO: "奧馳亞",
  CL: "高露潔",
  JNJ: "嬌生",
  UNH: "聯合健康",
  LLY: "禮來",
  ABBV: "艾伯維",
  MRK: "默沙東",
  PFE: "輝瑞",
  TMO: "賽默飛",
  ABT: "雅培",
  AMGN: "安進",
  JPM: "摩根大通",
  V: "Visa",
  MA: "萬事達",
  BAC: "美國銀行",
  WFC: "富國銀行",
  GS: "高盛",
  MS: "摩根士丹利",
  SPGI: "標普全球",
  BLK: "貝萊德",
  AXP: "美國運通",
  BRK: "波克夏",
  "BRK.B": "波克夏 B",
  XOM: "艾克森美孚",
  CVX: "雪佛龍",
  COP: "康菲石油",
  SLB: "斯倫貝謝",
  EOG: "EOG",
  BA: "波音",
  CAT: "卡特彼勒",
  GE: "通用電氣",
  HON: "霍尼韋爾",
  UNP: "聯合太平洋",
  UPS: "UPS",
  RTX: "RTX",
  DE: "迪爾",
  LMT: "洛克希德馬丁",
  LIN: "林德",
  APD: "空氣產品",
  SHW: "宣偉",
  NEE: "NextEra",
  SO: "南方電力",
  DUK: "杜克能源",
  PLD: "Prologis",
  AMT: "美國電塔",
  CCI: "Crown Castle",
  MU: "美光",
  TSM: "台積電 ADR",
  ASML: "艾司摩爾",
  LRCX: "科林研發",
  KLAC: "科磊",
  ARM: "安謀",
  SMCI: "超微電腦",
  IBM: "IBM",
  ACN: "埃森哲",
  ISRG: "直覺外科",
  PANW: "Palo Alto",
  SNOW: "Snowflake",
  PLTR: "Palantir",
  UBER: "優步",
  ABNB: "Airbnb",
  COIN: "Coinbase",
  SQ: "Block",
  PYPL: "PayPal",
  SHOP: "Shopify",
  SPCX: "SpaceX／太空探索",
  SNDK: "SanDisk／閃迪",
  BE: "Bloom Energy",
  MRNA: "Moderna／莫德納",
  HOOD: "Robinhood",
  SOFI: "SoFi",
  GILD: "吉立亞",
  BMY: "必治妥施貴寶",
};

/**
 * 無對照時的簡短中文：常見字尾翻譯，否則回傳英文短名。
 */
export function fallbackUsNameZh(
  code: string,
  englishName: string,
): string {
  const curated = US_NAME_ZH[code.toUpperCase()];
  if (curated) return curated;
  const en = englishName.trim();
  if (!en) return code;
  // 極簡：保留品牌第一詞作顯示（避免整串英文擠中文欄）
  const first = en.split(/[\s,/]+/)[0] || en;
  return first.length <= 16 ? first : first.slice(0, 14) + "…";
}

export function resolveUsDisplayNames(args: {
  code: string;
  yahooName?: string | null;
  nasdaqName?: string | null;
  longName?: string | null;
}): { nameEn: string; nameZh: string; name: string } {
  const code = args.code.toUpperCase();
  const nameEn =
    String(args.longName || "").trim() ||
    String(args.nasdaqName || "").trim() ||
    String(args.yahooName || "").trim() ||
    code;
  const nameZh = fallbackUsNameZh(code, nameEn);
  // name：中英並陳（列表主欄）
  const name =
    nameZh && nameZh !== nameEn ? `${nameEn}（${nameZh}）` : nameEn;
  return { nameEn, nameZh, name };
}
