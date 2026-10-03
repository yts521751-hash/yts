import { NextResponse } from "next/server";
import {
  buildIndustryFlowPayload,
  getIndustryFlowPayload,
} from "@/lib/build-industry-flow";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 台股盤後產業資金流（EOD）。
 * 預設讀快取；force=1 時以本機日檔重算並寫入 R2 側效應路徑。
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const force = searchParams.get("force") === "1";

  try {
    if (!force) {
      const cached = await getIndustryFlowPayload();
      if (cached?.rows?.length) {
        return NextResponse.json({
          ok: true,
          ...cached,
          dataProvenance: "twse+tpex-public",
        });
      }
    }

    const payload = await buildIndustryFlowPayload({
      force: true,
      cacheOnly: true,
    });
    return NextResponse.json({
      ok: true,
      ...payload,
      dataProvenance: "twse+tpex-public",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "產業流載入失敗";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 503 },
    );
  }
}
