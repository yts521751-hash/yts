export type WindLevel = "gale" | "gust" | "turbulence" | "calm";

/** 均線位置（多空結構），與風力度分數分開看 */
export type MaStance =
  | "bull-stack"
  | "bear-stack"
  | "above-ma20-ma60"
  | "above-ma20-ma60-below-ma5"
  | "above-ma20"
  | "above-ma60-only"
  | "below-ma20-ma60"
  | "below-ma20-ma60-above-ma5"
  | "below-ma20"
  | "tangled";

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
  /** 均線結構（站上／跌破），不是風力度 */
  maStance: MaStance;
  maStanceLabel: string;
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
    hint: "結構分數約 62 以上，或完整多頭／空頭排列（分數仍依站上／跌破階梯）",
    color: "var(--mk-surge)",
  },
  gust: {
    label: "陣風",
    hint: "結構分數約 36–61：半成形均線結構；細看右上角站上／跌破標籤",
    color: "var(--mk-rotate)",
  },
  turbulence: {
    label: "亂流",
    hint: "均線方向打架且波動偏高，結構不穩",
    color: "var(--mk-watch)",
  },
  calm: {
    label: "無風",
    hint: "結構分數低於 36，或均線糾結且波動低",
    color: "var(--mk-ebb)",
  },
};

export const MA_STANCE_LABEL: Record<MaStance, string> = {
  "bull-stack": "多頭排列",
  "bear-stack": "空頭排列",
  "above-ma20-ma60": "站上月季線",
  "above-ma20-ma60-below-ma5": "站上月季線、低於五日",
  "above-ma20": "站上月線",
  "above-ma60-only": "僅站上季線",
  "below-ma20-ma60": "跌破月季線",
  "below-ma20-ma60-above-ma5": "跌破月季線、高於五日",
  "below-ma20": "跌破月線",
  tangled: "均線糾結",
};
