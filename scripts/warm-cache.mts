import {
  loadMergedQuotesDay,
  listRecentTradingDays,
  readCacheFile,
  writeCacheFile,
  ACTIVE_FLOW_CACHE,
} from "../src/lib/tw-market";
import { buildTurnoverRanking } from "../src/lib/turnover";

async function main() {
  const days = await listRecentTradingDays(3, 20);
  console.log("days", days);
  for (const ymd of days) {
    const q = await loadMergedQuotesDay(ymd, { force: true });
    console.log("loaded", ymd, q?.quotes?.length);
  }

  const t = await buildTurnoverRanking(15, { live: false });
  console.log(
    "turnover top",
    t?.rows?.slice(0, 10).map((r) => `${r.rank} ${r.code} ${r.name} ${r.turnoverYi}億`),
  );
  console.log(
    "etfLeak",
    t?.rows?.filter((r) => r.code.startsWith("00")).map((r) => r.code),
  );

  // Patch existing flow-active stocks with close from latest quotes so UI shows prices
  const ymd = days[0];
  const quotes = ymd ? await loadMergedQuotesDay(ymd) : null;
  const map = new Map((quotes?.quotes ?? []).map((q) => [q.code, q]));
  const flow = await readCacheFile<{
    sectors?: Array<{ stocks?: Array<{ code: string; close?: number }> }>;
  }>(ACTIVE_FLOW_CACHE);
  if (flow?.sectors) {
    let n = 0;
    for (const s of flow.sectors) {
      for (const st of s.stocks ?? []) {
        const q = map.get(st.code);
        if (q?.close) {
          st.close = Math.round(q.close * 100) / 100;
          n++;
        }
      }
    }
    await writeCacheFile(ACTIVE_FLOW_CACHE, flow);
    console.log("patched close on", n, "stocks");
  } else {
    console.log("no flow-active to patch");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
