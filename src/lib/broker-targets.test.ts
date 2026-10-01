import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractBrokerTargetsFromText } from "./broker-targets";

describe("broker-targets extract", () => {
  it("parses 摩根士丹利 target from research sentence", () => {
    const text =
      "公布第二季財報後，摩根士丹利隨即將台積電目標價由2888元新台幣上調至2988元新台幣，並維持增持評級。";
    const rows = extractBrokerTargetsFromText(text, { asOf: "2026-08-16" });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].broker, "摩根士丹利");
    assert.equal(rows[0].target, 2988);
    assert.equal(rows[0].kind, "foreign");
  });

  it("parses 美銀 / 大摩 aliases", () => {
    const text =
      "美銀將目標價調升至2500元；大摩同步把目標價上看至1800元。";
    const rows = extractBrokerTargetsFromText(text);
    const by = Object.fromEntries(rows.map((r) => [r.broker, r.target]));
    assert.equal(by["美銀"], 2500);
    assert.equal(by["摩根士丹利"], 1800);
  });

  it("returns empty when no broker name", () => {
    const rows = extractBrokerTargetsFromText(
      "Factset 最新調查：預估目標價為3212.5元",
    );
    assert.equal(rows.length, 0);
  });
});
