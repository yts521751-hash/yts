/**
 * 金脈資金流：
 * 主訊號（80%）＝成交金額 × softSign(漲跌幅)
 * 輔訊號（20%）＝三大法人買賣超股數 × 收盤價（換成億元）
 *
 * softSign(chg) ≈ tanh(chg / 2.5)：小波動權重低，避免平盤假訊號。
 */

const YI = 1e8;

/** 成交×漲跌權重 */
export const PRICE_FLOW_WEIGHT = 0.8;
/** 法人買賣超權重 */
export const INSTI_FLOW_WEIGHT = 0.2;

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
 * 混合資金流。若當日沒有法人資料，退回純成交×漲跌，避免整體被縮成 80%。
 */
export function blendFlow(
  price: FlowParts,
  instiYi: number | null | undefined,
): FlowParts {
  if (instiYi == null || !Number.isFinite(instiYi)) {
    return price;
  }
  const instiIn = Math.max(0, instiYi);
  const instiOut = Math.max(0, -instiYi);
  const inflow =
    PRICE_FLOW_WEIGHT * price.inflow + INSTI_FLOW_WEIGHT * instiIn;
  const outflow =
    PRICE_FLOW_WEIGHT * price.outflow + INSTI_FLOW_WEIGHT * instiOut;
  return {
    amt: price.amt,
    flow: inflow - outflow,
    inflow,
    outflow,
  };
}

export function statusFromFlow(d5Flow: number, accel: number) {
  if (d5Flow > 0 && accel > 0) return "surge" as const;
  if (d5Flow > 0 && accel <= 0) return "rotate" as const;
  if (d5Flow <= 0 && accel >= 0) return "watch" as const;
  return "ebb" as const;
}
