import { MaScreenerClient } from "@/components/ma-screener-client";
import {
  buildMaScreener,
  readMaScreenerCache,
} from "@/lib/ma-screener";

export const dynamic = "force-dynamic";

export default async function MaPage() {
  // 有日終快照就只讀快取，開頁不再觸發背景重掃（避免拖慢）
  let initial = await readMaScreenerCache();
  if (!initial?.rows?.length) {
    try {
      initial = await buildMaScreener({ forceRebuildMissing: true });
    } catch {
      initial = null;
    }
  }

  return <MaScreenerClient initial={initial} />;
}
