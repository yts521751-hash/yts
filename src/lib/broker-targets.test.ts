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

  it("parses 目標股價 with thousand separators", () => {
    const text =
      "瑞銀周一上調台積電目標股價，由 3,000 新臺幣提升至 3,400 新臺幣，維持買入投資評級。";
    const rows = extractBrokerTargetsFromText(text);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].broker, "瑞銀");
    assert.equal(rows[0].target, 3400);
  });

  it("parses headline 高盛喊／美銀給 patterns", () => {
    const a = extractBrokerTargetsFromText("聯發科目標價 高盛喊7,000");
    assert.equal(a[0]?.broker, "高盛");
    assert.equal(a[0]?.target, 7000);

    const b = extractBrokerTargetsFromText(
      "美銀給日月光投控目標價 750 元",
    );
    assert.equal(b[0]?.broker, "美銀");
    assert.equal(b[0]?.target, 750);

    const c = extractBrokerTargetsFromText(
      "花旗調降目標價至2280元！台達電一度摔破1700元大關",
    );
    assert.equal(c[0]?.broker, "花旗");
    assert.equal(c[0]?.target, 2280);

    const d = extractBrokerTargetsFromText(
      "里昂喊升台積電目標價至3,700元",
    );
    assert.equal(d[0]?.broker, "里昂");
    assert.equal(d[0]?.target, 3700);
  });

  it("skips adjustment deltas without absolute 至", () => {
    const rows = extractBrokerTargetsFromText(
      "外資加碼廣達「目標價上調370元」AI伺服器營收拚再翻倍",
    );
    // 無具名券商或僅調幅 → 不應當成絕對目標價 370
    assert.ok(!rows.some((r) => r.target === 370));
  });

  it("returns empty when no broker name", () => {
    const rows = extractBrokerTargetsFromText(
      "Factset 最新調查：預估目標價為3212.5元",
    );
    assert.equal(rows.length, 0);
  });

  it("parses target with EPS in same sentence", () => {
    const text =
      "美銀最新報告上調奇鋐目標價至3540元，EPS預估倍增至99.23元";
    const rows = extractBrokerTargetsFromText(text);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].broker, "美銀");
    assert.equal(rows[0].target, 3540);
    assert.equal(rows[0].eps, 99.23);
  });

  it("parses 大摩 target + 明年 EPS year label", () => {
    const text =
      "大摩將華邦電目標價上調至222元，明年EPS上看56.06元";
    const rows = extractBrokerTargetsFromText(text);
    assert.equal(rows[0]?.broker, "摩根士丹利");
    assert.equal(rows[0]?.target, 222);
    assert.equal(rows[0]?.eps, 56.06);
    assert.equal(rows[0]?.epsYear, "明年");
  });

  it("keeps broker when only EPS is present", () => {
    const text = "元大預估緯穎明年EPS至145.03元，維持買進評等";
    const rows = extractBrokerTargetsFromText(text);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].broker, "元大");
    assert.equal(rows[0].target, null);
    assert.equal(rows[0].eps, 145.03);
    assert.equal(rows[0].epsYear, "明年");
  });

  it("parses 目標價飆 pattern", () => {
    const text =
      "大摩認錯了！記憶體行情比想像更猛 華邦電目標價飆222元、南亞科上看805元";
    const rows = extractBrokerTargetsFromText(text);
    const ms = rows.find((r) => r.broker === "摩根士丹利");
    assert.ok(ms);
    assert.equal(ms?.target, 222);
  });
});
