import { NextResponse } from "next/server";
import { isRebuildRunning } from "@/lib/build-flow";
import { isHistoryBackfillRunning } from "@/lib/history-backfill";
import { readRebuildProgress } from "@/lib/rebuild-progress";

export const dynamic = "force-dynamic";

/**
 * 輕量進度輪詢：只讀進度檔／旗標，不做日檔掃描或重算。
 * 首頁同步進度列專用，避免打 /api/flow 被重查拖慢甚至超時。
 */
export async function GET() {
  const progress = await readRebuildProgress();
  const rebuildRunning = isRebuildRunning() || isHistoryBackfillRunning();
  const busy = Boolean(progress.active) || rebuildRunning;
  return NextResponse.json({
    ok: true,
    busy,
    rebuildRunning,
    progress,
  });
}
