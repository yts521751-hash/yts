import { ValuePicksClient } from "@/components/value-picks-client";
import { readValuePicksCache } from "@/lib/value-picks";

export const dynamic = "force-dynamic";

export default async function ValuePage() {
  // SSR 只讀快照；缺資料由前端／API 觸發重建（避免首次開頁卡在大量法人 EPS 抓取）
  const initial = await readValuePicksCache();
  return <ValuePicksClient initial={initial} />;
}
