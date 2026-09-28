import { NextResponse } from "next/server";
import {
  readMaScreenerCache,
  requestMaScreenerWarmup,
} from "@/lib/ma-screener";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const force = searchParams.get("force") === "1";
  try {
    const cached = await readMaScreenerCache();
    if (cached?.rows?.length && !force) {
      return NextResponse.json({ ok: true, ...cached, source: "cache" });
    }

    // 缺快取或 force：背景暖機，有舊快照先回，避免 SSR／API 卡 ensureQuoteHistory
    const warm = requestMaScreenerWarmup(force ? "api-force" : "api-miss");
    if (cached?.rows?.length) {
      return NextResponse.json({
        ok: true,
        ...cached,
        source: "cache",
        syncing: true,
        rebuild: warm,
      });
    }

    return NextResponse.json(
      {
        ok: false,
        error: "均線掃描暖機中，請稍後再試",
        syncing: true,
        rebuild: warm,
      },
      { status: 503 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "均線掃描失敗";
    const cached = await readMaScreenerCache().catch(() => null);
    if (cached?.rows?.length) {
      return NextResponse.json({
        ok: true,
        ...cached,
        source: "cache",
        warning: message,
      });
    }
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
