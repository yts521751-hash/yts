import { NextResponse } from "next/server";
import { getLatestCachedTradingDay } from "@/lib/tw-market";
import {
  getValuePicksSingleFlight,
  isValuePicksCacheCurrent,
  lookupStockValue,
  readValuePicksCache,
  requestValuePicksRebuild,
} from "@/lib/value-picks";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
      const hit = await lookupStockValue(q);
      if (!hit) {
        return NextResponse.json(
          { ok: false, error: `找不到「${q}」` },
          { status: 404 },
        );
      }
      return NextResponse.json({ ok: true, lookup: hit });
    }

    const latestYmd = await getLatestCachedTradingDay();
    const cached = await readValuePicksCache();
    const asOfFresh = isValuePicksCacheCurrent(cached, latestYmd);

    // as-of 落後最新 quotes 日：前景重算（沿用 EPS 快取，更新 close／PE／PEG）
    if (!force && cached?.rows && !asOfFresh) {
      const data = await getValuePicksSingleFlight({ force: false });
      if (data) {
        return NextResponse.json({ ok: true, ...data });
      }
    }

    if (cached?.rows && !force && asOfFresh) {
      return NextResponse.json({
        ok: true,
        ...cached,
        source: "cache",
      });
    }

    if (force && cached?.rows && asOfFresh) {
      const rebuild = requestValuePicksRebuild("api-force");
      return NextResponse.json({
        ok: true,
        ...cached,
        source: "cache",
        syncing: true,
        rebuild,
      });
    }

    // 無快取、force、或 as-of 過舊：前景單飛（force 時重抓 EPS）
    const data = await getValuePicksSingleFlight({ force });
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
