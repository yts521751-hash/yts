import { NextResponse } from "next/server";
import { getWindPayload, requestWindRebuild } from "@/lib/wind-gauge";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const force = searchParams.get("force") === "1";
  try {
    // 一律先回快取／快速版，force 只觸發背景重建（含網路補齊）
    const data = await getWindPayload();
    const rebuild = force ? requestWindRebuild("api-force") : undefined;
    return NextResponse.json({
      ok: true,
      ...data,
      ...(rebuild ? { rebuild, syncing: true } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "風度讀取失敗";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
