/**
 * 金潮資金流核心觀念：
 * 成交金額 alone 沒有方向；漲跌幅 alone 沒有規模。
 * 兩者經 softSign 平滑後相乘，才得到「有方向的資金關注度」。
 *
 * softSign(chg) ≈ tanh(chg / 2.5)：
 *   +2.5% → ~0.76、+5% → ~0.96；下跌對稱為負。
 * 小波動權重低，避免平盤附近假訊號。
 */

const YI = 1e8;

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

export function statusFromFlow(d5Flow: number, accel: number) {
  if (d5Flow > 0 && accel > 0) return "surge" as const;
  if (d5Flow > 0 && accel <= 0) return "rotate" as const;
  if (d5Flow <= 0 && accel >= 0) return "watch" as const;
  return "ebb" as const;
}
