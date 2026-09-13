import { NextResponse } from "next/server";
import {
  getActiveFlowPayload,
  getDeployStatus,
  requestBackgroundRebuild,
} from "@/lib/build-flow";
import { getScheduleInfo } from "@/lib/scheduler";
import {
  MARKET_BRIEF,
  SECTORS,
  countByStatus,
  getContrarianSectors,
  getCpRanking,
  getTopBuySectors,
  migrateSectorIfNeeded,
} from "@/lib/mock-data";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * 灰度讀取：永遠回 active。
 * 僅在完全沒有真實快取時才用示範資料，並明確標示 isDemo／source。
 * force=1 只觸發背景重建，不阻塞回應。
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const force = searchParams.get("force") === "1";
  const fallback = searchParams.get("fallback") !== "0";
  const schedule = getScheduleInfo();

  let rebuild: { started: boolean; alreadyRunning: boolean } | null = null;
  if (force) {
    rebuild = requestBackgroundRebuild("api-force");
  }

  try {
    const payload = await getActiveFlowPayload();
    const deploy = await getDeployStatus();

    if (!payload?.sectors?.length) {
      if (!rebuild?.alreadyRunning && !deploy.rebuildRunning) {
        rebuild = requestBackgroundRebuild("api-empty-warmup");
      }
      if (!fallback) {
        return NextResponse.json(
          {
            ok: false,
            error: "尚無 active 快取，背景同步中",
            syncing: true,
            rebuild,
            schedule,
            deploy,
          },
          { status: 503 },
        );
      }
      return NextResponse.json({
        ok: false,
        error: "尚無真實快取，背景灰度同步中；暫顯示示範資料（非證交所即時）",
        brief: { ...MARKET_BRIEF, isDemo: true },
        sectors: SECTORS,
        tradingDays: [],
        source: "demo-fallback",
        isDemo: true,
        dataProvenance: "demo-not-exchange",
        builtAt: new Date().toISOString(),
        syncing: true,
        rebuild,
        schedule,
        deploy,
        meta: {
          sectorCount: SECTORS.length,
          statusCounts: countByStatus(SECTORS),
          cp: getCpRanking(SECTORS).map((s) => s.id),
          contrarian: getContrarianSectors(SECTORS).map((s) => s.id),
          topBuys: getTopBuySectors(SECTORS).map((s) => s.id),
        },
      });
    }

    const sectors = payload.sectors.map(migrateSectorIfNeeded);
    // 已有可用 active／last-close 時，背景重建不算「資料不完整」；
    // 只有實際在讀 staging（尚無正式 active）才標 syncing。
    const servingStaging = payload.deploySlot === "staging";
    const backgroundBusy =
      deploy.syncing ||
      deploy.rebuildRunning ||
      Boolean(rebuild?.started || rebuild?.alreadyRunning);
    return NextResponse.json({
      ok: true,
      ...payload,
      sectors,
      isDemo: false,
      dataProvenance: "twse+tpex-public",
      syncing: servingStaging,
      backgroundBusy,
      rebuild,
      schedule,
      deploy,
      meta: {
        sectorCount: sectors.length,
        statusCounts: countByStatus(sectors),
        cp: getCpRanking(sectors).map((s) => s.id),
        contrarian: getContrarianSectors(sectors).map((s) => s.id),
        topBuys: getTopBuySectors(sectors).map((s) => s.id),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "資料讀取失敗";
    if (!fallback) {
      return NextResponse.json(
        { ok: false, error: message, schedule },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: false,
      error: message,
      brief: { ...MARKET_BRIEF, isDemo: true },
      sectors: SECTORS,
      tradingDays: [],
      source: "demo-fallback",
      isDemo: true,
      dataProvenance: "demo-not-exchange",
      builtAt: new Date().toISOString(),
      schedule,
      meta: {
        sectorCount: SECTORS.length,
        statusCounts: countByStatus(SECTORS),
        cp: getCpRanking(SECTORS).map((s) => s.id),
        contrarian: getContrarianSectors(SECTORS).map((s) => s.id),
        topBuys: getTopBuySectors(SECTORS).map((s) => s.id),
      },
    });
  }
}
