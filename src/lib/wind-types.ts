export type WindLevel = "gale" | "gust" | "turbulence" | "calm";

export type WindReading = {
  market: "twse" | "tpex";
  label: string;
  level: WindLevel;
  levelLabel: string;
  score: number;
  close: number;
  changePct: number;
  bias5: number;
  bias20: number;
  bias60: number;
  vol20: number;
  asOf: string;
  source: string;
};

export type WindPayload = {
  twse: WindReading;
  tpex: WindReading;
  builtAt: string;
};

export const WIND_META: Record<
  WindLevel,
  { label: string; hint: string; color: string }
> = {
  gale: {
    label: "強風",
    hint: "均線多頭／空頭排列明確，趨勢風偏強",
    color: "var(--mk-surge)",
  },
  gust: {
    label: "陣風",
    hint: "短線有方向但均線未完全排齊，風一陣一陣",
    color: "var(--mk-rotate)",
  },
  turbulence: {
    label: "亂流",
    hint: "波動偏高且訊號打架，方向不穩",
    color: "var(--mk-watch)",
  },
  calm: {
    label: "無風",
    hint: "乖離小、波動低，盤勢平靜",
    color: "var(--mk-ebb)",
  },
};
