import { extractBrokerTargetsFromText, getBrokerTargetPrices } from "../src/lib/broker-targets.ts";

const ROUNDUP =
  "不過綜合外資看法，日系外資大和資本看好市場對於ABF載板需求暢旺，給予目標價到2460元；摩根士丹利（大摩）、美銀、高盛、花旗等則分別給到1550元、1700元、2500元及1600元。其他外資摩根士丹利（大摩）、美銀、高盛、花旗則分別給予南電1550元、1700元、2500元及1600元目標價。";

const GS =
  "其中，南電成為高盛看好的主要標的之一，給予「買進」評等，目標價上看2500元";

const DAIWA =
  "南電（8046）獲日商大和證券大舉調升目標價至2444元";

const MERRILL =
  "南電(8046)今日僅美林證券發布績效評等報告，評價為看多，目標價為1,700元。預估 2026年度營收約593.49億元、EPS約19.02元。";

console.log("=== EXTRACT UNIT SAMPLES ===");
for (const [label, text] of [
  ["ROUNDUP", ROUNDUP],
  ["GS", GS],
  ["DAIWA", DAIWA],
  ["MERRILL", MERRILL],
] as const) {
  const rows = extractBrokerTargetsFromText(text, { stockHints: ["南電", "8046"] });
  console.log(label, JSON.stringify(rows.map((r) => ({ b: r.broker, t: r.target, e: r.eps })), null, 0));
}

async function main() {
  console.log("\n=== LIVE getBrokerTargetPrices 8046 force ===");
  const t0 = Date.now();
  const payload = await getBrokerTargetPrices("8046", { name: "南電", force: true });
  console.log(
    JSON.stringify(
      {
        ms: Date.now() - t0,
        count: payload.targets.length,
        source: payload.source,
        emptyReason: payload.emptyReason,
        targets: payload.targets.map((r) => ({
          broker: r.broker,
          target: r.target,
          eps: r.eps,
          epsYear: r.epsYear,
          asOf: r.asOf,
          source: r.source,
          snippet: (r.snippet || "").slice(0, 80),
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
