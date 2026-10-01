import { ValuePicksClient } from "@/components/value-picks-client";
import { readUsValuePicksCache } from "@/lib/value-picks-us";

export const dynamic = "force-dynamic";

export default async function UsValuePage() {
  // SSR 只讀快照；缺資料由前端／API 觸發重建
  const initial = await readUsValuePicksCache();
  return <ValuePicksClient initial={initial} market="us" />;
}
