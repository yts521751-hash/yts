import { NextResponse } from "next/server";
import {
  getActiveFlowPayload,
  getDeployStatus,
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
 * 手動同步請打 /api/sync（前景串流進度），此處不再背景更新。
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const fallback = searchParams.get("fallback") !== "0";
  const schedule = getScheduleInfo();

  try {
    const payload = await getActiveFlowPayload();
    const deploy = await getDeployStatus();

    if (!payload?.sectors?.length) {
      if (!fallback) {
        return NextResponse.json(
          {
            ok: false,
            error: "尚無 active 快取，請點「同步資料」補齊",
            syncing: false,
            schedule,
            deploy,
          },
          { status: 503 },
        );
      }
      return NextResponse.json({
        ok: false,
        error: "尚無真實快取；暫顯示示範資料。請點「同步資料」補齊歷史。",
        brief: { ...MARKET_BRIEF, isDemo: true },
        sectors: SECTORS,
        tradingDays: [],
        source: "demo-fallback",
        isDemo: true,
        dataProvenance: "demo-not-exchange",
        builtAt: new Date().toISOString(),
        syncing: false,
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
    const backgroundBusy = deploy.syncing || deploy.rebuildRunning;
    return NextResponse.json({
      ok: true,
      ...payload,
      sectors,
      deploySlot: "active",
      isDemo: false,
      dataProvenance: "twse+tpex-public",
      syncing: false,
      backgroundBusy,
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
