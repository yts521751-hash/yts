import { NextResponse } from "next/server";
import { getBrokerTargetPrices } from "@/lib/broker-targets";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EMPTY_REASON = "近數年公開新聞未解析到具名券商目標價或預估 EPS";

function jsonOk(body: Record<string, unknown>, status = 200) {
  // 明確序列化，避免空 body；永遠帶 Content-Type: application/json
  return new NextResponse(JSON.stringify(body ?? {}), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function jsonError(error: string, status: number) {
  return jsonOk({ ok: false, error }, status);
}

/**
 * 懶加載個股內外資券商目標價／預估 EPS。
 * GET /api/broker-targets?code=2330&name=台積電
 * GET /api/broker-targets?code=2330&force=1
 *
 * 空結果一律 200 + 有效 JSON（targets: []），永不回空 body。
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const code = (searchParams.get("code") || "").trim();
    const name = searchParams.get("name")?.trim() || null;
    const force = searchParams.get("force") === "1";

    if (!/^\d{4}$/.test(code)) {
      return jsonError("請提供四位股票代號", 400);
    }

    try {
      const data = await getBrokerTargetPrices(code, { name, force });
      const targets = Array.isArray(data?.targets) ? data.targets : [];
      return jsonOk({
        ok: true,
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
