import { NextResponse } from "next/server";
import { getUsBrokerTargetPrices } from "@/lib/broker-targets-us";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EMPTY_REASON = "近數年公開新聞／Yahoo 未解析到具名券商目標價或預估 EPS";

function jsonOk(body: Record<string, unknown>, status = 200) {
  return new NextResponse(JSON.stringify(body ?? {}), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function jsonError(error: string, status: number) {
  return jsonOk({ ok: false, error, market: "us" }, status);
}

/**
 * 美股懶加載券商目標價／預估 EPS。
 * GET /api/us/broker-targets?code=AAPL&name=Apple
 * GET /api/us/broker-targets?code=NVDA&force=1
 *
 * 空結果一律 200 + 有效 JSON（targets: []）。
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const code = (searchParams.get("code") || "").trim().toUpperCase();
    const name = searchParams.get("name")?.trim() || null;
    const force = searchParams.get("force") === "1";

    if (!/^[A-Z]{1,5}(\.[A-Z])?$/.test(code)) {
      return jsonError("請提供美股代號（如 AAPL、BRK.B）", 400);
    }

    try {
      const data = await getUsBrokerTargetPrices(code, { name, force });
      const targets = Array.isArray(data?.targets) ? data.targets : [];
      return jsonOk({
        ok: true,
        market: "us",
        code: data?.code || code,
        name: data?.name || name || code,
        targets,
        builtAt: data?.builtAt || new Date().toISOString(),
        source: data?.source || "multi",
        emptyReason:
          data?.emptyReason ?? (targets.length ? null : EMPTY_REASON),
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "券商目標價讀取失敗";
      return jsonError(message, 502);
    }
  } catch {
    return jsonError("券商目標價請求無效", 400);
  }
}
