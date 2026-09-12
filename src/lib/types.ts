export type TideStatus = "surge" | "rotate" | "watch" | "ebb";

export interface StockFlow {
  code: string;
  name: string;
  /** 當日成交金額（億元） */
  dayAmt: number;
  /** 當日資金流（億）＝0.8×(成交×softSign)＋0.2×法人買賣超 */
  dayFlow: number;
  /** 當日流入貢獻（億） */
  dayIn: number;
  /** 當日流出貢獻（億） */
  dayOut: number;
  /** 近 3 日資金流合計（億） */
  d3Flow: number;
  /** 近 5 日資金流合計（億） */
  d5Flow: number;
  /** 近 20 日資金流合計（億） */
  d20Flow: number;
  /** 近 3 日成交金額合計（億） */
  d3: number;
  /** 近 5 日成交金額合計（億） */
  d5: number;
  /** 近 20 日成交金額合計（億） */
  d20: number;
  /** 當日漲跌幅 % */
  changePct: number;
  /** 最近月營收年增率 %（證交所／櫃買公開月營收） */
  revenueYoy?: number | null;
  /** 營收資料年月 */
  revenueMonth?: string | null;
  /** 市場共識 EPS 成長率 % */
  epsGrowth?: number | null;
  /** 共識下一年平均 EPS */
  nextYearEps?: number | null;
  /** 基準 EPS */
  baseEps?: number | null;
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
  /** 近 3 日淨資金流合計（億） */
  d3Flow: number;
  /** 近 5 日淨資金流合計（億） */
  d5Flow: number;
  /** 近 20 日淨資金流合計（億） */
  d20Flow: number;
  /** 近 3 日成交金額合計（億） */
  d3: number;
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
  /** industry=官方產業；theme=題材；auto=自動新興 */
  kind?: "industry" | "theme" | "auto";
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
    label: "強勢",
    short: "流入加速",
    hint: "近 5 日淨流入為正，且日均流高於近 20 日——資金加速進場",
    color: "var(--mk-surge)",
    bg: "var(--mk-surge-bg)",
  },
  rotate: {
    label: "輪動",
    short: "流入減速",
    hint: "仍有淨流入，但加速度轉弱——熱錢可能輪動中",
    color: "var(--mk-rotate)",
    bg: "var(--mk-rotate-bg)",
  },
  watch: {
    label: "觀望",
    short: "流出減速",
    hint: "近 5 日偏流出，但流出力道放緩——觀望是否止跌回補",
    color: "var(--mk-watch)",
    bg: "var(--mk-watch-bg)",
  },
  ebb: {
    label: "出場",
    short: "流出加速",
    hint: "淨流出且加速度為負——資金加速出場",
    color: "var(--mk-ebb)",
    bg: "var(--mk-ebb-bg)",
  },
};
