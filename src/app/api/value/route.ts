import { NextResponse } from "next/server";
import { buildValuePicks, readValuePicksCache } from "@/lib/value-picks";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const force = searchParams.get("force") === "1";
  try {
    let data = force ? null : await readValuePicksCache();
    if (!data?.rows) {
      data = await buildValuePicks({ force: true });
    } else if (force) {
      data = await buildValuePicks({ force: true });
    }
    if (!data) {
      return NextResponse.json(
        { ok: false, error: "尚無價值選股資料（請先同步報價）" },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "價值選股讀取失敗";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
