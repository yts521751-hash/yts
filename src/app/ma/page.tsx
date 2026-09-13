import { MaScreenerClient } from "@/components/ma-screener-client";
import {
  buildMaScreener,
  readMaScreenerCache,
} from "@/lib/ma-screener";

export const dynamic = "force-dynamic";

function isWeakMaSnapshot(
  payload: Awaited<ReturnType<typeof readMaScreenerCache>>,
) {
  if (!payload?.rows?.length) return true;
  const short = payload.rows.filter((r) => (r.bars ?? 0) < 10).length;
  const noMa10 = payload.rows.filter((r) => r.ma10 == null).length;
  return (
    short >= Math.ceil(payload.rows.length * 0.5) ||
    noMa10 >= Math.ceil(payload.rows.length * 0.5)
  );
}

export default async function MaPage() {
  let initial = await readMaScreenerCache();

  // 壞快照（多數無 MA10／日線不足）：同步重掃，否則兩線判定會一直是空的
  if (isWeakMaSnapshot(initial)) {
    try {
      initial = await buildMaScreener({
        forceRebuildMissing: true,
        skipDiskCache: true,
      });
    } catch {
      initial = initial?.rows?.length ? initial : null;
    }
  }

  return <MaScreenerClient initial={initial} />;
}
