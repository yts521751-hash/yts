/**
 * 台股產業分類顯示層：對齊證交所／櫃買 ISIN 產業別，
 * 並用市場常見短名（接近三竹「產業類型／類股」、券商類股報價）。
 *
 * CMoney 等 app 另有供應鏈細產業／題材多標籤——那層由 sector-universe 題材承擔，
 * 不在此強制改寫官方單標籤歸屬。
 */

export type IndustryMegaGroup = "電子" | "金融" | "傳產" | "其他";

/** ISIN 原文／舊別名 → 市場常見短名（顯示與聚合鍵） */
const INDUSTRY_ALIASES: Record<string, string> = {
  // 電子次產業（證交所八大＋新類）
  半導體業: "半導體",
  半導體: "半導體",
  電腦及週邊設備業: "電腦週邊",
  電腦及週邊設備: "電腦週邊",
  電腦週邊: "電腦週邊",
  光電業: "光電",
  光電: "光電",
  通信網路業: "通信網路",
  通訊網路業: "通信網路",
  通信網路: "通信網路",
  電子零組件業: "電子零組件",
  電子零組件: "電子零組件",
  電子通路業: "電子通路",
  電子通路: "電子通路",
  資訊服務業: "資訊服務",
  資訊服務: "資訊服務",
  其他電子業: "其他電子",
  其他電子: "其他電子",
  電子工業: "電子工業",
  數位雲端: "數位雲端",
  // 金融／服務／傳產
  金融保險業: "金融保險",
  金融保險: "金融保險",
  生技醫療業: "生技醫療",
  生技醫療: "生技醫療",
  建材營造業: "建材營造",
  建材營造: "建材營造",
  貿易百貨業: "貿易百貨",
  貿易百貨: "貿易百貨",
  油電燃氣業: "油電燃氣",
  油電燃氣: "油電燃氣",
  觀光事業: "觀光餐旅",
  觀光餐旅: "觀光餐旅",
  水泥工業: "水泥",
  水泥: "水泥",
  食品工業: "食品",
  食品: "食品",
  塑膠工業: "塑膠",
  塑膠: "塑膠",
  紡織纖維: "紡織",
  紡織: "紡織",
  電機機械: "電機機械",
  電器電纜: "電器電纜",
  玻璃陶瓷: "玻璃陶瓷",
  造紙工業: "造紙",
  造紙: "造紙",
  鋼鐵工業: "鋼鐵",
  鋼鐵: "鋼鐵",
  橡膠工業: "橡膠",
  橡膠: "橡膠",
  汽車工業: "汽車",
  汽車: "汽車",
  化學工業: "化學",
  化學: "化學",
  航運業: "航運",
  航運: "航運",
  文化創意業: "文化創意",
  文化創意: "文化創意",
  農業科技業: "農業科技",
  農業科技: "農業科技",
  綠能環保: "綠能環保",
  運動休閒: "運動休閒",
  居家生活: "居家生活",
  綜合: "綜合",
  其他業: "其他",
  其他: "其他",
};

const ELECTRONICS = new Set([
  "半導體",
  "電腦週邊",
  "光電",
  "通信網路",
  "電子零組件",
  "電子通路",
  "資訊服務",
  "其他電子",
  "電子工業",
  "數位雲端",
]);

const FINANCIAL = new Set(["金融保險"]);

const MISC = new Set(["其他", "綜合"]);

/** 正規化 ISIN／舊快取產業字串 → 顯示短名 */
export function normalizeIndustryName(raw: string): string {
  const s = raw.replace(/\s+/g, "").trim();
  if (!s) return s;
  return INDUSTRY_ALIASES[s] || s.replace(/業$/, "") || s;
}

/** 市場口語大板塊（電子／金融／傳產），對齊三竹類股／券商報價習慣 */
export function industryMegaGroup(name: string): IndustryMegaGroup {
  const n = normalizeIndustryName(name);
  if (ELECTRONICS.has(n)) return "電子";
  if (FINANCIAL.has(n)) return "金融";
  if (MISC.has(n)) return "其他";
  return "傳產";
}

export function industrySectorId(name: string): string {
  return `ind-${normalizeIndustryName(name)}`;
}

export function industryDisplayBasis(): string {
  return "依證交所／櫃買 ISIN 官方產業別（接近三竹產業類型／類股報價），全成分加總混合金流";
}
