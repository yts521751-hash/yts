import { buildTurnoverRanking } from "../src/lib/turnover";

async function main() {
  const p = await buildTurnoverRanking(15, { force: true });
  console.log(p?.date, p?.amountBasis);
  for (const r of p?.rows ?? []) {
    console.log(`${r.rank} ${r.code} ${r.name} ${r.turnoverYi}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
