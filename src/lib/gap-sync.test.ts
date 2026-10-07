import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  artifactsComplete,
  findMissingTradingDays,
  isMetaAsOfTarget,
  isNonTradingYmd,
  isPackageUpToDate,
  listWeekdaysBetween,
  resolveSyncTargetYmd,
  shouldUseLightDailyClose,
  toCompactYmd,
} from "./gap-sync";

describe("gap-sync", () => {
  it("toCompactYmd normalizes ISO dates", () => {
    assert.equal(toCompactYmd("2026-09-24"), "20260924");
    assert.equal(toCompactYmd("20260924"), "20260924");
  });

  it("listWeekdaysBetween skips weekends and TWSE holidays", () => {
    // watermark Thu 20260924 → until Wed 20260930
    // 20260925 中秋、20260926–27 週末、20260928 教師節 → 只剩 29–30
    const days = listWeekdaysBetween("20260924", "20260930", 10);
    assert.deepEqual(days, ["20260930", "20260929"]);
  });

  it("listWeekdaysBetween empty when already at target", () => {
    assert.deepEqual(listWeekdaysBetween("20260930", "20260930", 10), []);
  });

  it("findMissingTradingDays skips existing", () => {
    const missing = findMissingTradingDays(
      ["20260928", "20260925"],
      ["20260930", "20260929", "20260928"],
    );
    assert.deepEqual(missing, ["20260930", "20260929"]);
  });

  it("isNonTradingYmd covers Mid-Autumn and Teachers' Day 2026", () => {
    assert.equal(isNonTradingYmd("20260925"), true);
    assert.equal(isNonTradingYmd("20260928"), true);
    assert.equal(isNonTradingYmd("20260924"), false);
    assert.equal(isNonTradingYmd("20260926"), true); // Saturday
  });

  it("resolveSyncTargetYmd skips TWSE holidays (2026 Mid-Autumn week)", () => {
    // 2026-09-28 Monday Teachers' Day; 10:00 Taipei = UTC 02:00
    // prior calendar walk: Sun→Sat→Fri 中秋→Thu 20260924
    const morning = new Date("2026-09-28T02:00:00.000Z");
    assert.equal(resolveSyncTargetYmd(morning), "20260924");

    // 19:00 Taipei = UTC 11:00 — still Teachers' Day holiday → 20260924
    const evening = new Date("2026-09-28T11:00:00.000Z");
    assert.equal(resolveSyncTargetYmd(evening), "20260924");

    // Ordinary Tuesday after the break: 2026-09-29 10:00 Taipei → prior session 20260924
    const tueMorning = new Date("2026-09-29T02:00:00.000Z");
    assert.equal(resolveSyncTargetYmd(tueMorning), "20260924");

    // 2026-09-29 19:00 Taipei → today is a trading day
    const tueEvening = new Date("2026-09-29T11:00:00.000Z");
    assert.equal(resolveSyncTargetYmd(tueEvening), "20260929");
  });

  it("isPackageUpToDate requires matching asOf and complete artifacts", () => {
    const arts = {
      flow: true,
      quotesWarm: true,
      klines: false, // 產業 K 已下線：不再阻擋「已齊」
      stocks: true,
      wind: true,
      ma: true,
      turnoverClose: false, // 成交排行可開頁再補
      valuePicks: true,
      industryFlow: true,
    };
    assert.equal(artifactsComplete(arts), true);
    assert.equal(
      isPackageUpToDate({ asOf: "2026-09-26", artifacts: arts }, "20260926"),
      true,
    );
    assert.equal(
      isPackageUpToDate({ asOf: "2026-09-25", artifacts: arts }, "20260926"),
      false,
    );
    assert.equal(
      isPackageUpToDate(
        { asOf: "2026-09-26", artifacts: { ...arts, valuePicks: false } },
        "20260926",
      ),
      false,
    );
    assert.equal(
      isPackageUpToDate(
        { asOf: "2026-09-26", artifacts: { ...arts, industryFlow: false } },
        "20260926",
      ),
      false,
    );
  });

  it("isMetaAsOfTarget matches compact target without requiring artifacts", () => {
    assert.equal(
      isMetaAsOfTarget(
        {
          asOf: "2026-09-24",
          artifacts: {
            flow: true,
            quotesWarm: false,
            klines: false,
            stocks: false,
            wind: false,
            ma: false,
            turnoverClose: false,
            valuePicks: false,
            industryFlow: false,
          },
        },
        "20260924",
      ),
      true,
    );
    assert.equal(
      isMetaAsOfTarget({ asOf: "2026-09-24", artifacts: {} as never }, "20260925"),
      false,
    );
  });

  it("shouldUseLightDailyClose when quotes at target", () => {
    assert.equal(
      shouldUseLightDailyClose({
        latestQuoteYmd: "20261005",
        targetYmd: "20261005",
      }),
      true,
    );
    assert.equal(
      shouldUseLightDailyClose({
        force: true,
        latestQuoteYmd: "20261005",
        targetYmd: "20261005",
      }),
      false,
    );
    assert.equal(
      shouldUseLightDailyClose({
        latestQuoteYmd: "20261002",
        targetYmd: "20261005",
        preferLight: true,
      }),
      true,
    );
    assert.equal(
      shouldUseLightDailyClose({
        latestQuoteYmd: "20261002",
        targetYmd: "20261005",
      }),
      false,
    );
  });
});
