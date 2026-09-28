import { MaScreenerClient } from "@/components/ma-screener-client";
import {
  readMaScreenerCache,
  requestMaScreenerWarmup,
} from "@/lib/ma-screener";

export const dynamic = "force-dynamic";

export default async function MaPage() {
  // 首屏只讀快取；缺／壞快照交客戶端與背景暖機，避免 SSR 卡 ensureQuoteHistory
  const initial = await readMaScreenerCache();
  if (!initial?.rows?.length) {
    requestMaScreenerWarmup("ma-page-ssr");
  }

  return <MaScreenerClient initial={initial} />;
}
