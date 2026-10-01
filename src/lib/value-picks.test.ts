import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computePeg,
  forwardPeFromClose,
  isValuePicksCacheCurrent,
} from "./value-picks";
import {
  isUsValuePicksCacheCurrent,
  repriceUsValuePicksRows,
  usComputePeg,
  usForwardPeFromClose,
} from "./value-picks-us";

describe("value-picks as-of + PEG", () => {
  it("isValuePicksCacheCurrent requires matching latest quote ymd", () => {
    const cached = {
      ymd: "20260930",
      builtAt: new Date().toISOString(),
      rows: [{ code: "2330" }],
      criteria: { minEpsYoy: 50, maxForwardPe: 35, minDayAmtYi: 10 },
    };
    assert.equal(isValuePicksCacheCurrent(cached as never, "20260930"), true);
    assert.equal(isValuePicksCacheCurrent(cached as never, "20261001"), false);
    assert.equal(isValuePicksCacheCurrent(cached as never, null), false);
  });

  it("isValuePicksCacheCurrent rejects wrong criteria / expired TTL", () => {
    const base = {
      ymd: "20260930",
      builtAt: new Date().toISOString(),
      rows: [{ code: "2330" }],
      criteria: { minEpsYoy: 50, maxForwardPe: 35, minDayAmtYi: 10 },
    };
    assert.equal(
      isValuePicksCacheCurrent(
        { ...base, criteria: { ...base.criteria, minDayAmtYi: 5 } } as never,
        "20260930",
      ),
      false,
    );
    const old = {
      ...base,
      builtAt: new Date(Date.now() - 21 * 60 * 60 * 1000).toISOString(),
    };
    assert.equal(isValuePicksCacheCurrent(old as never, "20260930"), false);
  });

  it("forward PE and PEG use close / nextEps and PE / yoy%", () => {
    assert.equal(forwardPeFromClose(100, 10), 10);
    assert.equal(computePeg(20, 50), 0.4);
    assert.equal(computePeg(20, 0), null);
    assert.equal(computePeg(20, -5), null);
    assert.equal(computePeg(null, 50), null);
    assert.equal(usForwardPeFromClose(200, 8), 25);
    assert.equal(usComputePeg(25, 50), 0.5);
  });

  it("isUsValuePicksCacheCurrent only checks ymd alignment", () => {
    assert.equal(
      isUsValuePicksCacheCurrent(
        { ymd: "20260930", rows: [{}] } as never,
        "20260930",
      ),
      true,
    );
    assert.equal(
      isUsValuePicksCacheCurrent(
        { ymd: "20260929", rows: [{}] } as never,
        "20260930",
      ),
      false,
    );
  });

  it("repriceUsValuePicksRows refreshes close/PE/PEG from latest quotes", () => {
    const quotes = new Map([
      [
        "AAPL",
        { close: 220, changePct: 1.5, turnover: 8e9 }, // ≥ 0.5 億美元
      ],
    ]);
    const rows = repriceUsValuePicksRows({
      rows: [
        {
          rank: 1,
          code: "AAPL",
          name: "Apple",
          close: 200,
          changePct: 0.5,
          dayAmt: 0.7,
          nextYearEps: 10,
          baseEps: 7,
          epsYoy: 42.9,
          forwardPe: 20,
          peg: 0.47,
          epsSource: "test",
        },
      ],
      quotes,
      ymd: "20261001",
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.close, 220);
    assert.equal(rows[0]!.forwardPe, 22); // 220/10
    assert.equal(rows[0]!.peg, 0.51); // 22/42.9 ≈ 0.51
    assert.equal(rows[0]!.epsYoy, 42.9);
  });

  it("repriceUsValuePicksRows drops names that break PE / turnover gates", () => {
    const quotes = new Map([
      ["EXPENSIVE", { close: 500, changePct: 0, turnover: 1e9 }],
      ["THIN", { close: 100, changePct: 0, turnover: 1e6 }],
    ]);
    const rows = repriceUsValuePicksRows({
      rows: [
        {
          rank: 1,
          code: "EXPENSIVE",
          name: "X",
          close: 100,
          changePct: 0,
          dayAmt: 1,
          nextYearEps: 10,
          baseEps: 5,
          epsYoy: 100,
          forwardPe: 10,
          peg: 0.1,
          epsSource: "t",
        },
        {
          rank: 2,
          code: "THIN",
          name: "Y",
          close: 100,
          changePct: 0,
          dayAmt: 1,
          nextYearEps: 10,
          baseEps: 5,
          epsYoy: 100,
          forwardPe: 10,
          peg: 0.1,
          epsSource: "t",
        },
      ],
      quotes,
      ymd: "20261001",
    });
    // EXPENSIVE PE=50 >= 40; THIN dayAmt too small
    assert.equal(rows.length, 0);
  });
});
