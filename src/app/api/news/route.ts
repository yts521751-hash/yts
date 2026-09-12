import { NextResponse } from "next/server";
import {
  getActiveNewsPayload,
  readNewsMeta,
  requestNewsRebuild,
} from "@/lib/news";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const force = searchParams.get("force") === "1";

  let rebuild: { started: boolean; alreadyRunning: boolean } | null = null;
  if (force) {
    rebuild = requestNewsRebuild("api-force");
  }

  try {
    const payload = await getActiveNewsPayload();
    const meta = await readNewsMeta();
    const stale =
      !payload.builtAt ||
      Date.now() - Date.parse(payload.builtAt) > 1000 * 60 * 12;

    if ((stale || payload.source === "demo") && !meta.syncing) {
      rebuild = requestNewsRebuild(stale ? "api-stale" : "api-empty");
    }

    return NextResponse.json({
      ok: true,
      ...payload,
      syncing: meta.syncing || Boolean(rebuild?.started || rebuild?.alreadyRunning),
      rebuild,
      meta,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "新聞讀取失敗";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
