import { NextResponse } from "next/server";
import { computeWindPayload, getWindPayload } from "@/lib/wind-gauge";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const force = searchParams.get("force") === "1";
  try {
    const data = force
      ? await computeWindPayload({ force: true })
      : await getWindPayload();
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "風度讀取失敗";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
