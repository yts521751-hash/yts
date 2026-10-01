import { NextResponse } from "next/server";
import { getUsWindGauge, requestUsWindRebuild } from "@/lib/wind-gauge-us";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const force = searchParams.get("force") === "1";
  try {
    if (force) requestUsWindRebuild("api-force");
    const payload = await getUsWindGauge({ force: false });
    return NextResponse.json({
      ok: true,
      ...payload,
      // 相容 WindDashboard：映射成 twse/tpex 欄位名
      twse: payload.spx,
      tpex: payload.ndx,
      market: "us",
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "風度讀取失敗",
        market: "us",
      },
      { status: 502 },
    );
  }
}
