/**
 * 金脈資金流：
 * 主訊號（80%）＝成交金額 × softSign(漲跌幅)
 * 輔訊號（20%）＝
 *   - 台股：三大法人買賣超股數 × 收盤價（換成億元）
 *   - 美股：相對成交量（rvol）活動／壓力代理（非外資／投信／自營）
 *
 * softSign(chg) ≈ tanh(chg / 2.5)：小波動權重低，避免平盤假訊號。
 */

const YI = 1e8;

/** 成交×漲跌權重 */
export const PRICE_FLOW_WEIGHT = 0.8;
/** 法人買賣超／相對成交量輔訊號權重 */
export const INSTI_FLOW_WEIGHT = 0.2;
/** 美股輔訊號別名（與 INSTI_FLOW_WEIGHT 相同） */
export const RVOL_FLOW_WEIGHT = INSTI_FLOW_WEIGHT;

export function toYi(ntd: number): number {
  return ntd / YI;
}

export function softSign(changePct: number, scale = 2.5): number {
  if (!Number.isFinite(changePct) || changePct === 0) return 0;
  return Math.tanh(changePct / scale);
}

export type FlowParts = {
  amt: number;
  flow: number;
  inflow: number;
  outflow: number;
};

export function signedFlowFromQuote(
  turnoverNtd: number,
  changePct: number,
): FlowParts {
  const amt = toYi(Math.max(0, turnoverNtd));
  const w = softSign(changePct);
  const flow = amt * w;
  return {
    amt,
    flow,
    inflow: w > 0 ? flow : 0,
    outflow: w < 0 ? -flow : 0,
  };
}

/** 法人買賣超股數 × 股價 → 億元（可為負＝賣超） */
export function instiSharesToYi(shares: number, price: number): number {
  if (!Number.isFinite(shares) || !Number.isFinite(price) || price <= 0) {
    return 0;
  }
  return toYi(shares * price);
}

/**
 * 混合資金流。若當日沒有輔訊號（法人／rvol），退回純成交×漲跌，避免整體被縮成 80%。
 */
export function blendFlow(
  price: FlowParts,
  secondaryYi: number | null | undefined,
): FlowParts {
  if (secondaryYi == null || !Number.isFinite(secondaryYi)) {
    return price;
  }
  const secIn = Math.max(0, secondaryYi);
  const secOut = Math.max(0, -secondaryYi);
  const inflow =
    PRICE_FLOW_WEIGHT * price.inflow + INSTI_FLOW_WEIGHT * secIn;
  const outflow =
    PRICE_FLOW_WEIGHT * price.outflow + INSTI_FLOW_WEIGHT * secOut;
  return {
    amt: price.amt,
    flow: inflow - outflow,
    inflow,
    outflow,
  };
}

/**
 * 相對成交量（當日成交 ÷ 近約 20 日均成交）。
 * 無足夠歷史時回 null → 呼叫端應 100% 用價格流。
 */
export function relativeVolume(
  todayTurnover: number,
  avgTurnover: number | null | undefined,
): number | null {
  if (
    !Number.isFinite(todayTurnover) ||
    todayTurnover <= 0 ||
    avgTurnover == null ||
    !Number.isFinite(avgTurnover) ||
    avgTurnover <= 0
  ) {
    return null;
  }
  return todayTurnover / avgTurnover;
}

/**
 * 美股輔訊號：相對成交量活動／壓力代理（億美元單位，可為負＝賣壓方向）。
 * 高於均量且上漲 → 正壓力；高於均量且下跌 → 負壓力；均量附近 ≈ 0。
 * 不標示為外資／投信／自營。
 */
export function rvolProxyYi(
  amtYi: number,
  changePct: number,
  rvol: number | null | undefined,
): number | null {
  if (rvol == null || !Number.isFinite(rvol) || rvol <= 0) return null;
  if (!Number.isFinite(amtYi) || amtYi <= 0) return null;
  // rvol=1 → 0；rvol≈2 → 接近滿幅；方向跟漲跌
  const excess = softSign((rvol - 1) * 4, 1);
  return amtYi * softSign(changePct) * excess;
}

/** 美股混合：80% 成交×漲跌 + 20% 相對成交量；rvol 缺則 100% 價格流 */
export function blendUsFlow(
  turnover: number,
  changePct: number,
  rvol: number | null | undefined,
): FlowParts {
  const price = signedFlowFromQuote(turnover, changePct);
  return blendFlow(price, rvolProxyYi(price.amt, changePct, rvol));
}

export function statusFromFlow(d5Flow: number, accel: number) {
  if (d5Flow > 0 && accel > 0) return "surge" as const;
  if (d5Flow > 0 && accel <= 0) return "rotate" as const;
  if (d5Flow <= 0 && accel >= 0) return "watch" as const;
  return "ebb" as const;
}
