import { NextResponse } from "next/server";
import { getUsSectorKline } from "@/lib/sector-kline-us";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id: raw } = await ctx.params;
  const id = decodeURIComponent(raw);
  const { searchParams } = new URL(req.url);
  const days = Number(searchParams.get("days") || 80);
  const force = searchParams.get("force") === "1";
  try {
    const payload = await getUsSectorKline(id, { days, force });
    if (!payload?.candles?.length) {
      return NextResponse.json(
        { ok: false, error: `尚無板塊 ${id} 的 K 線`, market: "us" },
        { status: 404 },
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
