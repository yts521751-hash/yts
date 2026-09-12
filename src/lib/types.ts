export type TideStatus = "surge" | "rotate" | "watch" | "ebb";

export interface StockFlow {
  code: string;
  name: string;
  /** 當日法人買賣超（億元） */
  dayNet: number;
  /** 近 5 日累計（億元） */
  d5: number;
  /** 近 20 日累計（億元） */
  d20: number;
  /** 當日漲跌幅 % */
  changePct: number;
  foreign: number;
  trust: number;
  dealer: number;
}

export interface SectorFlow {
  id: string;
  name: string;
  /** 近 5 日法人累計買賣超（億元）→ 泡泡 X */
  d5: number;
  /** 相對近 20 日日均的加速度（億元/日）→ 泡泡 Y */
  accel: number;
  /** 近 20 日累計絕對金額規模（億元）→ 泡泡大小 */
  d20Abs: number;
  /** 近 20 日累計淨額（億元） */
  d20Net: number;
  /** 近 20 日股價漲幅 % */
  priceChange20d: number;
  status: TideStatus;
  /** 是否為逆勢買超標記 */
  contrarian?: boolean;
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
    label: "漲潮",
    short: "流入加速",
    hint: "資金流入且在加速，動能最強",
    color: "var(--tide-surge)",
    bg: "var(--tide-surge-bg)",
  },
  rotate: {
    label: "輪動",
    short: "流入放緩",
    hint: "還在流入但力道放緩，熱度可能轉移",
    color: "var(--tide-rotate)",
    bg: "var(--tide-rotate-bg)",
  },
  watch: {
    label: "觀望",
    short: "流出放緩",
    hint: "資金沉寂、賣壓在退，方向不明",
    color: "var(--tide-watch)",
    bg: "var(--tide-watch-bg)",
  },
  ebb: {
    label: "退潮",
    short: "流出加速",
    hint: "資金加速流出，籌碼鬆動",
    color: "var(--tide-ebb)",
    bg: "var(--tide-ebb-bg)",
  },
};
