import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  blendFlow,
  blendUsFlow,
  relativeVolume,
  rvolProxyYi,
  signedFlowFromQuote,
  softSign,
} from "./money-flow";

describe("us rvol flow substitute", () => {
  it("relativeVolume returns null when avg missing", () => {
    assert.equal(relativeVolume(1e9, null), null);
    assert.equal(relativeVolume(1e9, 0), null);
    assert.equal(relativeVolume(0, 1e8), null);
  });

  it("relativeVolume is today/avg", () => {
    assert.equal(relativeVolume(200, 100), 2);
    assert.equal(relativeVolume(50, 100), 0.5);
  });

  it("rvolProxyYi is null when rvol unavailable → caller uses 100% price flow", () => {
    assert.equal(rvolProxyYi(10, 2, null), null);
    const price = signedFlowFromQuote(1e8, 2);
    const blended = blendFlow(price, null);
    assert.equal(blended.flow, price.flow);
  });

  it("rvol ~1 yields near-zero secondary; high rvol amplifies with price direction", () => {
    const amt = 10;
    const up = rvolProxyYi(amt, 3, 1);
    assert.ok(up != null && Math.abs(up) < 0.05);

    const hotUp = rvolProxyYi(amt, 3, 2)!;
    const hotDown = rvolProxyYi(amt, -3, 2)!;
    assert.ok(hotUp > 0);
    assert.ok(hotDown < 0);
    assert.ok(Math.abs(hotUp) > Math.abs(up!));
  });

  it("blendUsFlow is 80/20 when rvol present", () => {
    const turnover = 1e8; // 1 億 → amt=1
    const changePct = 5;
    const price = signedFlowFromQuote(turnover, changePct);
    const rvol = 2;
    const secondary = rvolProxyYi(price.amt, changePct, rvol)!;
    const blended = blendUsFlow(turnover, changePct, rvol);
    const expectedIn =
      0.8 * price.inflow + 0.2 * Math.max(0, secondary);
    const expectedOut =
      0.8 * price.outflow + 0.2 * Math.max(0, -secondary);
    assert.ok(Math.abs(blended.inflow - expectedIn) < 1e-9);
    assert.ok(Math.abs(blended.outflow - expectedOut) < 1e-9);
    assert.ok(softSign(changePct) > 0);
  });

  it("blendUsFlow falls back to pure price flow without rvol", () => {
    const turnover = 2e8;
    const changePct = -2;
    const price = signedFlowFromQuote(turnover, changePct);
    const blended = blendUsFlow(turnover, changePct, null);
    assert.equal(blended.flow, price.flow);
    assert.equal(blended.amt, price.amt);
  });
});
