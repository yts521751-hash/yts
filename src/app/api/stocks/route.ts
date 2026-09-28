import { NextResponse } from "next/server";
import {
  getStockFlowRanking,
  isStockFlowRebuilding,
  requestStockFlowRebuild,
} from "@/lib/stock-flow";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(
    100,
    Math.max(10, Number(searchParams.get("limit") || 50)),
  );
  const force = searchParams.get("force") === "1";
  try {
    // 有快照秒回；force／過期由 getStockFlowRanking 觸發背景重算
    const data = await getStockFlowRanking(limit, { force });
    if (!data?.rows?.length) {
      // 冷啟動無快取時 get 已等過單飛；仍空則回 503
      return NextResponse.json(
        {
          ok: false,
          error: "尚無個股資金流資料（需先有報價快取）",
          syncing: isStockFlowRebuilding(),
        },
        { status: 503 },
      );
    }
    return NextResponse.json({
      ok: true,
      ...data,
      ...(force
        ? {
            syncing: true,
            rebuild: requestStockFlowRebuild("api-force", {
              force: true,
              limit,
            }),
          }
        : {}),
      backgroundBusy: isStockFlowRebuilding(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "個股資金流讀取失敗";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
