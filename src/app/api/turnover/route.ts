import { NextResponse } from "next/server";
import { buildTurnoverRanking } from "@/lib/turnover";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(200, Math.max(20, Number(searchParams.get("limit") || 100)));
  try {
    const data = await buildTurnoverRanking(limit);
    if (!data?.rows?.length) {
      return NextResponse.json(
        {
          ok: false,
          error: "尚無成交金額快取，請回首頁觸發背景更新後再試",
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "成交排行讀取失敗";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
