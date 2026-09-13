import { NextResponse } from "next/server";
import {
  buildMaScreener,
  readMaScreenerCache,
} from "@/lib/ma-screener";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const force = searchParams.get("force") === "1";
  try {
    // 先回磁碟快取；若多數無 MA20（日線不足）則重掃
    if (!force) {
      const cached = await readMaScreenerCache();
      if (cached?.rows?.length) {
        return NextResponse.json({ ok: true, ...cached, source: "cache" });
      }
    }

    const data = await buildMaScreener({
      forceRebuildMissing: true,
      skipDiskCache: true,
    });
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "均線掃描失敗";
    // 失敗時仍嘗試吐出舊快取，避免頁面全空
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
