import { MaScreenerClient } from "@/components/ma-screener-client";
import {
  buildMaScreener,
  readMaScreenerCache,
  requestMaScreenerWarmup,
} from "@/lib/ma-screener";

export const dynamic = "force-dynamic";

export default async function MaPage() {
  let initial = await readMaScreenerCache();
  if (!initial?.rows?.length) {
    // 冷啟動：同步建一次，確保首屏有列；之後背景暖機
    try {
      initial = await buildMaScreener({ forceRebuildMissing: true });
    } catch {
      initial = null;
    }
  } else {
    requestMaScreenerWarmup("ma-page");
  }

  return <MaScreenerClient initial={initial} />;
}
