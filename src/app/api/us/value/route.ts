import { NextResponse } from "next/server";
import {
  getUsValuePicks,
  lookupUsStockValue,
  readUsValuePicksCache,
} from "@/lib/value-picks-us";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const force = searchParams.get("force") === "1";
  const q =
    searchParams.get("q")?.trim() ||
    searchParams.get("lookup")?.trim() ||
    searchParams.get("code")?.trim() ||
    "";

  try {
    if (q) {
      const hit = await lookupUsStockValue(q);
      if (!hit) {
        return NextResponse.json(
          { ok: false, error: `找不到「${q}」`, market: "us" },
          { status: 404 },
        );
      }
      return NextResponse.json({ ok: true, lookup: hit, market: "us" });
    }

    if (!force) {
      const cached = await readUsValuePicksCache();
      if (cached?.rows?.length) {
        return NextResponse.json({
          ok: true,
          ...cached,
          source: "cache",
          market: "us",
        });
      }
    }

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
