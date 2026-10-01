import { NextResponse } from "next/server";
import { getUsStockFlowRanking } from "@/lib/stock-flow-us";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Number(searchParams.get("limit") || 50);
  const force = searchParams.get("force") === "1";
  try {
    const payload = await getUsStockFlowRanking(limit, { force });
    if (!payload?.rows?.length) {
      return NextResponse.json(
        {
          ok: false,
          error: "尚無美股個股金流，請先同步",
          market: "us",
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: true, ...payload, market: "us" });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "讀取失敗",
        market: "us",
      },
      { status: 502 },
    );
  }
}
