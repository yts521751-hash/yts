import { NextResponse } from "next/server";
import { buildTurnoverRanking } from "@/lib/turnover";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") || 50)));
  const live = searchParams.get("live") === "1";
  try {
    const data = await buildTurnoverRanking(limit, { live });
    if (!data?.rows?.length) {
      return NextResponse.json(
        { ok: false, error: "尚無成交金額資料" },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "成交排行讀取失敗";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
