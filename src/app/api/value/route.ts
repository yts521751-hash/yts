import { NextResponse } from "next/server";
import {
  getValuePicksSingleFlight,
  readValuePicksCache,
  requestValuePicksRebuild,
} from "@/lib/value-picks";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const force = searchParams.get("force") === "1";
  try {
    const cached = await readValuePicksCache();
    if (cached?.rows && !force) {
      const age = Date.now() - Date.parse(cached.builtAt || "");
      const fresh =
        Number.isFinite(age) && age >= 0 && age < 20 * 60 * 60 * 1000;
      if (!fresh) {
        requestValuePicksRebuild("stale-cache");
      }
      return NextResponse.json({
        ok: true,
        ...cached,
        source: "cache",
      });
    }

    if (force && cached?.rows) {
      const rebuild = requestValuePicksRebuild("api-force");
      return NextResponse.json({
        ok: true,
        ...cached,
        source: "cache",
        syncing: true,
        rebuild,
      });
    }

    // 無快取：前景單飛建一次（不帶 force，沿用既有 EPS／排除額快取）
    const data = await getValuePicksSingleFlight({ force: false });
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
