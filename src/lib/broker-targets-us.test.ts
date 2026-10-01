import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractUsBrokerTargetsFromText } from "./broker-targets-us";

describe("us broker-targets extract", () => {
  it("parses Goldman raises price target to $N", () => {
    const rows = extractUsBrokerTargetsFromText(
      "Goldman Sachs raises NVDA price target to $180 from $150, maintains Buy.",
      { stockHints: ["NVDA", "Nvidia"] },
    );
    assert.equal(rows[0]?.broker, "高盛");
    assert.equal(rows[0]?.target, 180);
  });

  it("parses BofA PT of $N", () => {
    const rows = extractUsBrokerTargetsFromText(
      "BofA Securities price target of $220 on Apple (AAPL).",
      { stockHints: ["AAPL", "Apple"] },
    );
    assert.equal(rows[0]?.broker, "美銀");
    assert.equal(rows[0]?.target, 220);
  });

  it("parses Jefferies EPS estimate", () => {
    const rows = extractUsBrokerTargetsFromText(
      "Jefferies raises FY2026 EPS estimate to $6.40 on MSFT.",
      { stockHints: ["MSFT"] },
    );
    assert.equal(rows[0]?.broker, "傑富瑞");
    assert.equal(rows[0]?.eps, 6.4);
    assert.equal(rows[0]?.epsYear, "2026");
  });

  it("parses Chinese US-stock target sentence", () => {
    const rows = extractUsBrokerTargetsFromText(
      "高盛將輝達目標價上看至200美元，維持買入評等。",
      { stockHints: ["NVDA", "輝達"] },
    );
    assert.equal(rows[0]?.broker, "高盛");
    assert.equal(rows[0]?.target, 200);
  });

  it("returns empty without broker", () => {
    const rows = extractUsBrokerTargetsFromText(
      "Consensus price target is $150 for the stock.",
    );
    assert.equal(rows.length, 0);
  });
});
