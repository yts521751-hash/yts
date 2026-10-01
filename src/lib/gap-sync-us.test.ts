import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isUsMarketHolidayYmd,
  isUsMetaAsOfTarget,
  isUsNonTradingYmd,
  isUsPackageUpToDate,
  prevUsTradingDayYmd,
  resolveUsSyncTargetYmd,
  usArtifactsComplete,
} from "./gap-sync-us";

describe("gap-sync-us", () => {
  it("skips weekends and NYSE holidays", () => {
    // 2026-07-04 is Saturday
    assert.equal(isUsNonTradingYmd("20260704"), true);
    assert.equal(isUsNonTradingYmd("20260703"), true); // Independence observed Fri
    assert.equal(isUsMarketHolidayYmd("20261126"), true); // Thanksgiving
    assert.equal(isUsNonTradingYmd("20260930"), false); // Wed trading day
  });

  it("prevUsTradingDayYmd walks over Labor Day weekend 2026", () => {
    // 2026-09-07 Labor Day Monday → prior Fri 20260904
    assert.equal(prevUsTradingDayYmd("20260908"), "20260904");
  });

  it("resolveUsSyncTargetYmd uses America/New_York 18:00 cutoff", () => {
    // 2026-09-30 Wednesday 10:00 ET = 14:00 UTC → prior session 20260929
    const morning = new Date("2026-09-30T14:00:00.000Z");
    assert.equal(resolveUsSyncTargetYmd(morning), "20260929");

    // 19:00 ET = 23:00 UTC → today
    const evening = new Date("2026-09-30T23:00:00.000Z");
    assert.equal(resolveUsSyncTargetYmd(evening), "20260930");

    // Thanksgiving 2026-11-26 Thursday — any clock → prior Wed 20261125
    const turkey = new Date("2026-11-26T20:00:00.000Z");
    assert.equal(resolveUsSyncTargetYmd(turkey), "20261125");
  });

  it("us package up-to-date helpers", () => {
    const arts = {
      quotes: true,
      flow: true,
      stocks: true,
      klines: true,
      wind: true,
      ma: true,
      turnover: true,
      valuePicks: true,
    };
    assert.equal(usArtifactsComplete(arts), true);
    assert.equal(
      isUsPackageUpToDate({ asOf: "2026-09-30", artifacts: arts }, "20260930"),
      true,
    );
    assert.equal(
      isUsMetaAsOfTarget({ asOf: "2026-09-30", artifacts: arts }, "20260930"),
      true,
    );
    assert.equal(
      isUsPackageUpToDate(
        { asOf: "2026-09-30", artifacts: { ...arts, turnover: false } },
        "20260930",
      ),
      false,
    );
  });
});
