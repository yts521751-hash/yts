import { NextResponse } from "next/server";
import { getBrokerTargetPrices } from "@/lib/broker-targets";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 懶加載個股內外資券商目標價。
 * GET /api/broker-targets?code=2330&name=台積電
 * GET /api/broker-targets?code=2330&force=1
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = (searchParams.get("code") || "").trim();
  const name = searchParams.get("name")?.trim() || null;
  const force = searchParams.get("force") === "1";

  if (!/^\d{4}$/.test(code)) {
    return NextResponse.json(
      { ok: false, error: "請提供四位股票代號" },
      { status: 400 },
    );
  }

  try {
    const data = await getBrokerTargetPrices(code, { name, force });
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "券商目標價讀取失敗";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
