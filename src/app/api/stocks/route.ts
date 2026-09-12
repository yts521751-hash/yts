import { NextResponse } from "next/server";
import { buildStockFlowRanking } from "@/lib/stock-flow";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(
    100,
    Math.max(10, Number(searchParams.get("limit") || 50)),
  );
  const force = searchParams.get("force") === "1";
  try {
    const data = await buildStockFlowRanking(limit, { force });
    if (!data?.rows?.length) {
      return NextResponse.json(
        { ok: false, error: "尚無個股資金流資料（需先有報價快取）" },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "個股資金流讀取失敗";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
