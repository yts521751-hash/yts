import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * 輕量單元測試：個股金流快取閘門（amountBasis／TTL）邏輯。
 * 不打交易所；僅驗證純函式行為（從實作抽出同語意副本）。
 */

const AMOUNT_BASIS =
  "一般成交金額（上市／上櫃總成交 − 盤後定價 − 零股 − 鉅額；對齊 Yahoo／媒體常見口徑）";
const CACHE_TTL_MS = 20 * 60 * 60 * 1000;

type Snap = { amountBasis?: string; builtAt?: string; rows?: unknown[] };

function hasRegularBasis(cached: Snap): boolean {
  return cached.amountBasis === AMOUNT_BASIS;
}

function isFreshCache(cached: Snap, now = Date.now()): boolean {
  const age = now - Date.parse(cached.builtAt || "");
  return Number.isFinite(age) && age >= 0 && age < CACHE_TTL_MS;
}

function shouldServeCacheFast(cached: Snap | null, force: boolean): boolean {
  if (force) return Boolean(cached?.rows?.length);
  return Boolean(cached?.rows?.length);
}

function needsBackgroundRebuild(cached: Snap, force: boolean): boolean {
  if (!cached.rows?.length) return true;
  return force || !hasRegularBasis(cached) || !isFreshCache(cached);
}

describe("stock-flow cache gates", () => {
  it("serves any snapshot with rows when not forcing wait", () => {
    const legacy = {
      rows: [{ code: "2330" }],
      amountBasis: "total",
      builtAt: new Date().toISOString(),
    };
    assert.equal(shouldServeCacheFast(legacy, false), true);
    assert.equal(needsBackgroundRebuild(legacy, false), true);
  });

  it("fresh regular-basis cache does not need rebuild", () => {
    const ok = {
      rows: [{ code: "2330" }],
      amountBasis: AMOUNT_BASIS,
      builtAt: new Date().toISOString(),
    };
    assert.equal(hasRegularBasis(ok), true);
    assert.equal(isFreshCache(ok), true);
    assert.equal(needsBackgroundRebuild(ok, false), false);
  });

  it("stale or force triggers background rebuild while still serving", () => {
    const stale = {
      rows: [{ code: "2330" }],
      amountBasis: AMOUNT_BASIS,
      builtAt: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(),
    };
    assert.equal(shouldServeCacheFast(stale, false), true);
    assert.equal(needsBackgroundRebuild(stale, false), true);
    assert.equal(shouldServeCacheFast(stale, true), true);
    assert.equal(needsBackgroundRebuild(stale, true), true);
  });
});
