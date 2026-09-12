import { NextResponse } from "next/server";
import { buildSectorKline } from "@/lib/sector-kline";
import { SECTOR_UNIVERSE } from "@/lib/sector-universe";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const def = SECTOR_UNIVERSE.find((s) => s.id === id);
  if (!def) {
    return NextResponse.json({ ok: false, error: "找不到此產業" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const days = Math.min(120, Math.max(20, Number(searchParams.get("days") || 80)));
  const force = searchParams.get("force") === "1";

  try {
    const data = await buildSectorKline(id, days, { force });
    if (!data?.candles?.length) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "產業 K 線資料不足。請回首頁按「觸發背景更新」暖機日行情後再試（本頁只讀快取，不會卡住瀏覽器）。",
          sectorId: id,
          sectorName: def.name,
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "K 線組建失敗";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
