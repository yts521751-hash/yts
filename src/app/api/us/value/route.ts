import { NextResponse } from "next/server";
import { getUsValuePicks } from "@/lib/value-picks-us";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const force = searchParams.get("force") === "1";
  try {
    const payload = await getUsValuePicks({ force });
    if (!payload) {
      return NextResponse.json(
        { ok: false, error: "尚無美股價值選股", market: "us" },
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
