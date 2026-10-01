import { NextResponse } from "next/server";
import { listUsCachedTradingDays } from "@/lib/us-market";
import {
  getUsValuePicks,
  isUsValuePicksCacheCurrent,
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

    const latestYmd = (await listUsCachedTradingDays(1, 40))[0] ?? null;

    if (!force) {
      const cached = await readUsValuePicksCache();
      if (
        cached?.rows?.length &&
        isUsValuePicksCacheCurrent(cached, latestYmd)
      ) {
        return NextResponse.json({
          ok: true,
          ...cached,
          source: "cache",
          market: "us",
        });
      }
    }

    // 無快取、force、或 as-of 落後最新 quotes → 重建／重算收盤 PE
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
