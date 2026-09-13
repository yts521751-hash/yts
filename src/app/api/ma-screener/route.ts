import { NextResponse } from "next/server";
import { buildMaScreener } from "@/lib/ma-screener";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const force = searchParams.get("force") === "1";
  try {
    const data = await buildMaScreener({ forceRebuildMissing: force });
    return NextResponse.json({
      ok: true,
      ...data,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "均線掃描失敗";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
