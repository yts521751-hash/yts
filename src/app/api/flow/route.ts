import { NextResponse } from "next/server";
import { buildFlowPayload } from "@/lib/build-flow";
import { getScheduleInfo } from "@/lib/scheduler";
import {
  MARKET_BRIEF,
  SECTORS,
  countByStatus,
  getContrarianSectors,
  getCpRanking,
  getTopBuySectors,
} from "@/lib/mock-data";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const force = searchParams.get("force") === "1";
  const fallback = searchParams.get("fallback") !== "0";
  const schedule = getScheduleInfo();

  try {
    const payload = await buildFlowPayload({ force });
    return NextResponse.json({
      ok: true,
      ...payload,
      schedule,
      meta: {
        sectorCount: payload.sectors.length,
        statusCounts: countByStatus(payload.sectors),
        cp: getCpRanking(payload.sectors).map((s) => s.id),
        contrarian: getContrarianSectors(payload.sectors).map((s) => s.id),
        topBuys: getTopBuySectors(payload.sectors).map((s) => s.id),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "資料抓取失敗";
    if (!fallback) {
      return NextResponse.json(
        { ok: false, error: message, schedule },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: false,
      error: message,
      brief: MARKET_BRIEF,
      sectors: SECTORS,
      tradingDays: [],
      source: "demo-fallback",
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
