import { NextResponse } from "next/server";
import {
  getActiveUsFlowPayload,
  getUsDeployStatus,
} from "@/lib/build-flow-us";
import { getScheduleInfo } from "@/lib/scheduler";
import {
  countByStatus,
  getContrarianSectors,
  getCpRanking,
  getTopBuySectors,
  migrateSectorIfNeeded,
} from "@/lib/mock-data";
import { US_DATA_PROVENANCE } from "@/lib/us-market";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const fallback = searchParams.get("fallback") !== "0";
  const schedule = getScheduleInfo();

  try {
    const payload = await getActiveUsFlowPayload();
    const deploy = await getUsDeployStatus();

    if (!payload?.sectors?.length) {
      if (!fallback) {
        return NextResponse.json(
          {
            ok: false,
            error: "尚無美股 active 快取，請點「同步資料」",
            syncing: false,
            schedule,
            deploy,
            market: "us",
          },
          { status: 503 },
        );
      }
      return NextResponse.json({
        ok: false,
        error: "尚無美股快取；請點「同步資料」從 Yahoo 拉日終包。",
        brief: {
          date: new Date().toISOString().slice(0, 10),
          indexChangePct: 0,
          fearLabel: "中性",
          fearScore: 48,
          updatedAt: "—",
          isDemo: true,
        },
        sectors: [],
        tradingDays: [],
        source: "empty",
        isDemo: true,
        dataProvenance: "demo-not-yahoo",
        market: "us",
        flowLabel: "美股金流（成交×漲跌＋相對成交量）",
        formula: "us-blend-80-20-rvol",
        builtAt: new Date().toISOString(),
        syncing: false,
        schedule,
        deploy,
        meta: {
          sectorCount: 0,
          statusCounts: { surge: 0, rotate: 0, watch: 0, ebb: 0 },
          cp: [],
          contrarian: [],
          topBuys: [],
        },
      });
    }

    const sectors = payload.sectors.map(migrateSectorIfNeeded);
    return NextResponse.json({
      ok: true,
      ...payload,
      sectors,
      deploySlot: "active",
      isDemo: false,
      dataProvenance: US_DATA_PROVENANCE,
      market: "us",
      flowLabel: payload.flowLabel || "美股金流（成交×漲跌＋相對成交量）",
      syncing: false,
      backgroundBusy: deploy.syncing || deploy.rebuildRunning,
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
    const message = err instanceof Error ? err.message : "美股資料讀取失敗";
    return NextResponse.json(
      { ok: false, error: message, schedule, market: "us" },
      { status: 502 },
    );
  }
}
