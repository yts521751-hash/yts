import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeR2Endpoint } from "./r2-cache";

describe("normalizeR2Endpoint", () => {
  const account = "0123456789abcdef0123456789abcdef";

  it("builds default endpoint from account id", () => {
    const { endpoint, warnings } = normalizeR2Endpoint("", account);
    assert.equal(
      endpoint,
      `https://${account}.r2.cloudflarestorage.com`,
    );
    assert.equal(warnings.length, 0);
  });

  it("upgrades http to https and strips trailing slash/path", () => {
    const { endpoint, warnings } = normalizeR2Endpoint(
      `http://${account}.r2.cloudflarestorage.com/jinliu-cache/`,
      account,
    );
    assert.equal(endpoint, `https://${account}.r2.cloudflarestorage.com`);
    assert.ok(warnings.some((w) => /http/i.test(w)));
    assert.ok(warnings.some((w) => /path/i.test(w)));
  });

  it("rewrites bucket-virtual host to account endpoint", () => {
    const { endpoint, warnings } = normalizeR2Endpoint(
      `https://jinliu-cache.${account}.r2.cloudflarestorage.com`,
      account,
    );
    assert.equal(endpoint, `https://${account}.r2.cloudflarestorage.com`);
    assert.ok(warnings.some((w) => /virtual/i.test(w)));
  });
});
