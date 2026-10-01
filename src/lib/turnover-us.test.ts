import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { usdTurnoverToYi, US_YI_USD } from "./turnover-us";
import { formatUsTurnoverYi } from "./format";
import { isUsCommonStock } from "./us-market";

describe("us turnover unit / formula", () => {
  it("usdTurnoverToYi is close×volume / 1e8 (億美元)", () => {
    // Approximate user reference session: MU ~331, NVDA ~278, AAPL ~166.5, META ~139.9
    assert.equal(US_YI_USD, 1e8);
    assert.equal(usdTurnoverToYi(331.3e8), 331.3);
    assert.equal(usdTurnoverToYi(278e8), 278);
    assert.equal(usdTurnoverToYi(166.5e8), 166.5);
    assert.equal(usdTurnoverToYi(139.9e8), 139.9);

    // Realistic: close * shares
    const mu = 1065.11 * 30_538_500;
    const yi = usdTurnoverToYi(mu);
    assert.ok(yi > 300 && yi < 360, `MU yi=${yi}`);
  });

  it("formatUsTurnoverYi labels 億美元", () => {
    assert.equal(formatUsTurnoverYi(278), "278.0 億美元");
    assert.equal(formatUsTurnoverYi(166.5), "166.5 億美元");
  });

  it("isUsCommonStock keeps megacaps and drops ETF-like names", () => {
    assert.equal(isUsCommonStock("MU", "Micron"), true);
    assert.equal(isUsCommonStock("NVDA", "NVIDIA"), true);
    assert.equal(isUsCommonStock("AAPL", "Apple"), true);
    assert.equal(isUsCommonStock("META", "Meta"), true);
    assert.equal(isUsCommonStock("SPY", "SPDR S&P 500 ETF Trust"), false);
    assert.equal(isUsCommonStock("QQQ", "Invesco QQQ Trust"), false);
  });
});
