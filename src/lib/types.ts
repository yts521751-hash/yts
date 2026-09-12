export type TideStatus = "surge" | "rotate" | "watch" | "ebb";

export interface StockFlow {
  code: string;
  name: string;
  /** 當日成交金額（億元） */
  dayAmt: number;
  /** 當日資金流（億）＝成交金額 × softSign(漲跌幅) */
  dayFlow: number;
  /** 當日流入貢獻（億） */
  dayIn: number;
  /** 當日流出貢獻（億） */
  dayOut: number;
  /** 近 5 日資金流合計（億） */
  d5Flow: number;
  /** 近 20 日資金流合計（億） */
  d20Flow: number;
  /** 近 5 日成交金額合計（億） */
  d5: number;
  /** 近 20 日成交金額合計（億） */
  d20: number;
  /** 當日漲跌幅 % */
  changePct: number;
}

export interface SectorFlow {
  id: string;
  name: string;
  /** 當日板塊成交金額合計（億元） */
  dayAmt: number;
  /** 當日淨資金流（億） */
  dayFlow: number;
  dayIn: number;
  dayOut: number;
  /** 近 5 日淨資金流合計（億） */
  d5Flow: number;
  /** 近 20 日淨資金流合計（億） */
  d20Flow: number;
  /** 近 5 日成交金額合計（億） */
  d5: number;
  /** 近 20 日成交金額合計（億） */
  d20: number;
  /** 近 5 日日均流 − 近 20 日日均流（億/日） */
  accel: number;
  /** 近 5 日日均成交 / 近 20 日日均成交 */
  heat: number;
  /** 近 20 日股價漲幅 % */
  priceChange20d: number;
  status: TideStatus;
  volumeSpike?: boolean;
  stocks: StockFlow[];
}

/** 產業合成 K 線 */
export interface SectorCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  amount: number;
  flow: number;
  inflow: number;
  outflow: number;
  changePct: number;
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
    hint: "近 5 日淨流入為正，且日均流高於近 20 日——資金加速進場",
    color: "var(--tide-surge)",
    bg: "var(--tide-surge-bg)",
  },
  rotate: {
    label: "輪動",
    short: "流入減速",
    hint: "仍有淨流入，但加速度轉弱——熱錢可能輪動中",
    color: "var(--tide-rotate)",
    bg: "var(--tide-rotate-bg)",
  },
  watch: {
    label: "觀望",
    short: "流出減速",
    hint: "近 5 日偏流出，但流出力道放緩——觀望是否止跌回補",
    color: "var(--tide-watch)",
    bg: "var(--tide-watch-bg)",
  },
  ebb: {
    label: "退潮",
    short: "流出加速",
    hint: "淨流出且加速度為負——資金加速撤離",
    color: "var(--tide-ebb)",
    bg: "var(--tide-ebb-bg)",
  },
};
