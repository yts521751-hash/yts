import { rebuildFlowPayload } from "../src/lib/build-flow";

async function main() {
  console.log("rebuilding flow…");
  const flow = await rebuildFlowPayload({ promote: true });
  const s = flow.sectors?.[0];
  console.log(
    "ok",
    flow.brief?.date,
    "sectors",
    flow.sectors?.length,
    "demo?",
    flow.brief?.isDemo,
  );
  console.log(
    "sample",
    s?.name,
    s?.stocks?.slice(0, 3).map((x) => ({
      code: x.code,
      name: x.name,
      close: x.close,
      dayAmt: x.dayAmt,
    })),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
