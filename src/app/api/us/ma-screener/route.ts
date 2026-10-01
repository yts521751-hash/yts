import { NextResponse } from "next/server";
import { getUsMaScreener } from "@/lib/ma-screener-us";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const force = searchParams.get("force") === "1";
  try {
    const payload = await getUsMaScreener({ force });
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
