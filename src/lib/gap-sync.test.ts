import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  artifactsComplete,
  findMissingTradingDays,
  isPackageUpToDate,
  listWeekdaysBetween,
  resolveSyncTargetYmd,
  toCompactYmd,
} from "./gap-sync";

describe("gap-sync", () => {
  it("toCompactYmd normalizes ISO dates", () => {
    assert.equal(toCompactYmd("2026-09-24"), "20260924");
    assert.equal(toCompactYmd("20260924"), "20260924");
  });

  it("listWeekdaysBetween returns only weekdays after watermark", () => {
    // watermark Friday 20260925 → until Wednesday 20260930 → Mon–Wed
    const days = listWeekdaysBetween("20260925", "20260930", 10);
    assert.deepEqual(days, ["20260930", "20260929", "20260928"]);
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

  it("resolveSyncTargetYmd uses prior session before Taipei 18:00 on weekday", () => {
    // 2026-09-28 is Monday; 10:00 Taipei = UTC 02:00
    const morning = new Date("2026-09-28T02:00:00.000Z");
    assert.equal(resolveSyncTargetYmd(morning), "20260925"); // prior Friday

    // 19:00 Taipei = UTC 11:00
    const evening = new Date("2026-09-28T11:00:00.000Z");
    assert.equal(resolveSyncTargetYmd(evening), "20260928");
  });

  it("isPackageUpToDate requires matching asOf and complete artifacts", () => {
    const arts = {
      flow: true,
      quotesWarm: true,
      klines: true,
      stocks: true,
      wind: true,
      ma: true,
      turnoverClose: true,
      valuePicks: true,
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
  });
});
