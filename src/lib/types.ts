export type TideStatus = "surge" | "rotate" | "watch" | "ebb";

export interface StockFlow {
  code: string;
  name: string;
  /** 當日成交金額（億元） */
  dayAmt: number;
  /** 近 5 日成交金額合計（億元） */
  d5: number;
  /** 近 20 日成交金額合計（億元） */
  d20: number;
  /** 當日漲跌幅 % */
  changePct: number;
}

export interface SectorFlow {
  id: string;
  name: string;
  /** 當日板塊成交金額合計（億元） */
  dayAmt: number;
  /** 近 5 日成交金額合計（億元） */
  d5: number;
  /** 近 5 日日均 − 近 20 日日均（億元/日） */
  accel: number;
  /** 近 5 日日均 / 近 20 日日均 */
  heat: number;
  /** 近 20 日成交金額合計（億元） */
  d20: number;
  /** 近 20 日股價漲幅 % */
  priceChange20d: number;
  status: TideStatus;
  /** 大跌日異常放量 */
  volumeSpike?: boolean;
  stocks: StockFlow[];
}

export interface MarketBrief {
  date: string;
  indexChangePct: number;
  fearLabel: string;
  fearScore: number;
  updatedAt: string;
  isDemo: boolean;
}

export const STATUS_META: Record<
  TideStatus,
  { label: string; short: string; hint: string; color: string; bg: string }
> = {
  surge: {
    label: "放量",
    short: "成交放大",
    hint: "近 5 日成交明顯高於近 20 日均量，熱度最強",
    color: "var(--tide-surge)",
    bg: "var(--tide-surge-bg)",
  },
  rotate: {
    label: "偏熱",
    short: "略高於均量",
    hint: "成交仍偏熱但未大幅放大，熱度可能在輪動",
    color: "var(--tide-rotate)",
    bg: "var(--tide-rotate-bg)",
  },
  watch: {
    label: "偏冷",
    short: "略低於均量",
    hint: "成交略低於均量，資金關注度下降",
    color: "var(--tide-watch)",
    bg: "var(--tide-watch-bg)",
  },
  ebb: {
    label: "縮量",
    short: "成交萎縮",
    hint: "近 5 日成交明顯低於近 20 日均量，關注度退潮",
    color: "var(--tide-ebb)",
    bg: "var(--tide-ebb-bg)",
  },
};
