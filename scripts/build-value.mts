import { buildValuePicks } from "../src/lib/value-picks";

async function main() {
  console.log("building value picks…");
  const p = await buildValuePicks({ force: true });
  console.log("rows", p?.rows?.length, "scanned", p?.scanned, "date", p?.date);
  for (const r of p?.rows?.slice(0, 12) ?? []) {
    console.log(
      `${r.rank} ${r.code} ${r.name} yoy=${r.epsYoy}% pe=${r.forwardPe} eps=${r.nextYearEps}/${r.baseEps}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
