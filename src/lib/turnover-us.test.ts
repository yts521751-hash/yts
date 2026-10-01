import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { usdTurnoverToYi, US_YI_USD, AMOUNT_BASIS } from "./turnover-us";
import { formatUsTurnoverYi } from "./format";
import { isUsCommonStock } from "./us-market";
import { cleanNasdaqCompanyName } from "./nasdaq-us";
import { resolveUsDisplayNames, US_NAME_ZH } from "./us-company-names";

describe("us turnover unit / formula", () => {
  it("usdTurnoverToYi is dollarVolume / 1e8 (億美元)", () => {
    assert.equal(US_YI_USD, 1e8);
    assert.equal(usdTurnoverToYi(331.3e8), 331.3);
    assert.equal(usdTurnoverToYi(278e8), 278);
    assert.equal(usdTurnoverToYi(166.5e8), 166.5);
    assert.equal(usdTurnoverToYi(139.9e8), 139.9);
  });

  it("Nasdaq volume × close matches user refs (MU/NVDA/AAPL/META)", () => {
    // Live session fixture (2026-09-30): Nasdaq Share Volume × Yahoo/Nasdaq last
    const cases = [
      { code: "MU", close: 1065.11, nasdaqVol: 31_105_125, ref: 331.3 },
      { code: "NVDA", close: 228.38, nasdaqVol: 121_888_559, ref: 278 },
      { code: "AAPL", close: 333.02, nasdaqVol: 49_988_830, ref: 166.5 },
      { code: "META", close: 725.18, nasdaqVol: 19_293_753, ref: 139.9 },
    ];
    for (const c of cases) {
      const yi = usdTurnoverToYi(c.close * c.nasdaqVol);
      const rounded = Math.round(yi * 10) / 10;
      assert.ok(
        Math.abs(rounded - c.ref) <= 0.5,
        `${c.code}: got ${rounded} want ~${c.ref}`,
      );
    }
    assert.ok(AMOUNT_BASIS.includes("Nasdaq"));
  });

  it("Yahoo chart volume alone understates MU vs ref", () => {
    const yahooYi = usdTurnoverToYi(1065.11 * 30_538_500);
    assert.ok(yahooYi < 328, `yahoo MU yi=${yahooYi}`);
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

  it("display names include EN + ZH", () => {
    assert.equal(US_NAME_ZH.MU, "美光");
    assert.equal(US_NAME_ZH.NVDA, "輝達");
    const names = resolveUsDisplayNames({
      code: "MU",
      nasdaqName: cleanNasdaqCompanyName(
        "Micron Technology, Inc. Common Stock",
      ),
    });
    assert.equal(names.nameEn, "Micron Technology");
    assert.equal(names.nameZh, "美光");
    assert.ok(names.name.includes("美光"));
  });
});
