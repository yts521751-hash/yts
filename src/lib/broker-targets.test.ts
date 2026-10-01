import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractBrokerTargetsFromText } from "./broker-targets";
import { shouldApplyBrokerFetch } from "./broker-fetch-guard";

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

  it("parses EPS from-to taking the destination", () => {
    const rows = extractBrokerTargetsFromText(
      "凱基證券將目標價由180上修至220，EPS由12上修至18.5",
    );
    assert.equal(rows[0]?.broker, "凱基");
    assert.equal(rows[0]?.target, 220);
    assert.equal(rows[0]?.eps, 18.5);
  });

  it("parses 每股純益 as EPS", () => {
    const rows = extractBrokerTargetsFromText(
      "群益投顧看好，目標價上看85元，預估明年每股純益6.2元",
    );
    assert.equal(rows[0]?.broker, "群益");
    assert.equal(rows[0]?.target, 85);
    assert.equal(rows[0]?.eps, 6.2);
    assert.equal(rows[0]?.epsYear, "明年");
  });

  it("parses parenthetical EPS after target", () => {
    const rows = extractBrokerTargetsFromText(
      "野村上調目標價至450元（EPS 35）",
    );
    assert.equal(rows[0]?.broker, "野村");
    assert.equal(rows[0]?.target, 450);
    assert.equal(rows[0]?.eps, 35);
  });

  it("parses multi-broker 分別給到 list", () => {
    const text =
      "日系外資大和資本看好，給予目標價到2460元；摩根士丹利（大摩）、美銀、高盛、花旗等則分別給到1550元、1700元、2500元及1600元。";
    const rows = extractBrokerTargetsFromText(text, {
      stockHints: ["南電", "8046"],
    });
    const by = Object.fromEntries(rows.map((r) => [r.broker, r.target]));
    assert.equal(by["大和"], 2460);
    assert.equal(by["摩根士丹利"], 1550);
    assert.equal(by["美銀"], 1700);
    assert.equal(by["高盛"], 2500);
    assert.equal(by["花旗"], 1600);
  });

  it("parses 分別給予股名＋價目＋目標價 suffix", () => {
    const text =
      "其他外資摩根士丹利（大摩）、美銀、高盛、花旗則分別給予南電1550元、1700元、2500元及1600元目標價。";
    const rows = extractBrokerTargetsFromText(text, {
      stockHints: ["南電"],
    });
    const by = Object.fromEntries(rows.map((r) => [r.broker, r.target]));
    assert.equal(by["摩根士丹利"], 1550);
    assert.equal(by["美銀"], 1700);
    assert.equal(by["高盛"], 2500);
    assert.equal(by["花旗"], 1600);
  });

  it("ignores year-as-target in 高盛喊2028年 headlines", () => {
    const rows = extractBrokerTargetsFromText(
      "高盛喊2028年暴缺51％！欣興、南電、景碩、臻鼎...ABF四雄目標價1次看：他EPS14元→28.8元",
      { stockHints: ["南電", "8046"] },
    );
    assert.ok(!rows.some((r) => r.target === 2028));
    assert.ok(!rows.some((r) => r.eps === 14));
  });

  it("skips 這家目標價 ambiguous single-broker headlines", () => {
    const rows = extractBrokerTargetsFromText(
      "ABF載板鬼故事連篇 大摩一一拆解 外資按讚欣興、南電 「這家」目標價直上2460元",
      { stockHints: ["南電", "8046"] },
    );
    assert.equal(rows.length, 0);
  });
});

describe("shouldApplyBrokerFetch", () => {
  it("applies only when request code still matches and not aborted", () => {
    assert.equal(shouldApplyBrokerFetch("2330", "2330", false), true);
    assert.equal(shouldApplyBrokerFetch("2330", "2454", false), false);
    assert.equal(shouldApplyBrokerFetch("2330", "2330", true), false);
    assert.equal(shouldApplyBrokerFetch("2454", "2454", true), false);
  });
});
