import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  readResponseJson,
  tryReadResponseJson,
} from "./read-response-json";

function fakeResponse(body: string, status = 200, contentType = "application/json") {
  return new Response(body, {
    status,
    headers: contentType ? { "Content-Type": contentType } : undefined,
  });
}

describe("tryReadResponseJson", () => {
  it("returns null for empty body instead of throwing", async () => {
    const json = await tryReadResponseJson(fakeResponse(""));
    assert.equal(json, null);
  });

  it("returns null for whitespace-only body", async () => {
    const json = await tryReadResponseJson(fakeResponse("  \n  "));
    assert.equal(json, null);
  });

  it("returns null for HTML / non-JSON", async () => {
    assert.equal(
      await tryReadResponseJson(fakeResponse("<!DOCTYPE html><html></html>")),
      null,
    );
    assert.equal(await tryReadResponseJson(fakeResponse("not-json")), null);
  });

  it("parses valid JSON objects including empty {}", async () => {
    assert.deepEqual(await tryReadResponseJson(fakeResponse("{}")), {});
    assert.deepEqual(
      await tryReadResponseJson(
        fakeResponse('{"ok":true,"targets":[],"emptyReason":"尚無"}'),
      ),
      { ok: true, targets: [], emptyReason: "尚無" },
    );
  });
});

describe("readResponseJson", () => {
  it("throws Traditional Chinese message on empty body, not native JSON error", async () => {
    await assert.rejects(
      () => readResponseJson(fakeResponse("")),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /伺服器回傳空白/);
        assert.doesNotMatch(err.message, /Unexpected end of JSON/i);
        return true;
      },
    );
  });
});
