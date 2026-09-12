import { NextResponse } from "next/server";
import {
  computeWindPayload,
  getWindPayload,
  requestWindRebuild,
} from "@/lib/wind-gauge";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const force = searchParams.get("force") === "1";
  try {
    if (force) {
      // 強制：本機快取先回一版，網路補齊改背景，避免請求逾時
      const data = await computeWindPayload({
        force: true,
        allowNetwork: false,
      });
      const rebuild = requestWindRebuild("api-force");
      return NextResponse.json({ ok: true, ...data, rebuild });
    }
    const data = await getWindPayload();
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "風度讀取失敗";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
