import { NextResponse } from "next/server";
import { buildSectorKline } from "@/lib/sector-kline";
import { lookupSectorDef } from "@/lib/resolve-universe";
import { membersWithTurnover } from "@/lib/sector-members";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const raw = (await ctx.params).id;
  let id = raw;
  try {
    id = decodeURIComponent(raw);
  } catch {
    id = raw;
  }
  const def = await lookupSectorDef(id);
  if (!def) {
    return NextResponse.json({ ok: false, error: "找不到此產業" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const { HISTORY_TRADING_DAYS } = await import("@/lib/tw-market");
  const days = Math.min(
    HISTORY_TRADING_DAYS,
    Math.max(20, Number(searchParams.get("days") || HISTORY_TRADING_DAYS)),
  );
  const force = searchParams.get("force") === "1";
  const { members, asOf: membersAsOf } = await membersWithTurnover(def.members);

  try {
    const data = await buildSectorKline(id, days, { force, def });
    if (!data?.candles?.length) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "產業 K 線資料不足。請回首頁按「觸發背景更新」暖機日行情後再試（本頁只讀快取，不會卡住瀏覽器）。",
          sectorId: id,
          sectorName: def.name,
          members,
          membersAsOf,
        },
        { status: 503 },
      );
    }
    const res = NextResponse.json({
      ok: true,
      ...data,
      members,
      membersAsOf,
    });
    // 短快取：同產業短時間重複開啟可走瀏覽器／邊緣快取
    if (data.source === "cache" || data.source === "memory") {
      res.headers.set(
        "Cache-Control",
        "public, max-age=30, stale-while-revalidate=120",
      );
    } else {
      res.headers.set("Cache-Control", "public, max-age=10, stale-while-revalidate=60");
    }
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "K 線組建失敗";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
