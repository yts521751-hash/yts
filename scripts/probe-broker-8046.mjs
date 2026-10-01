/**
 * Offline/live probe for 8046 broker targets — before/after diagnostics.
 * Run: node --experimental-strip-types scripts/probe-broker-8046.mjs
 * Or via tsx after compiling imports.
 */
import { createRequire } from "module";
import { pathToFileURL } from "url";
import { execFile } from "child_process";
import { promisify } from "util";

const run = promisify(execFile);

async function curlGet(url, timeoutSec = 16) {
  try {
    const { stdout } = await run(
      "curl",
      [
        "-sS",
        "-L",
        "-A",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "--max-time",
        String(timeoutSec),
        url,
      ],
      { timeout: (timeoutSec + 4) * 1000, maxBuffer: 4 * 1024 * 1024 },
    );
    return String(stdout || "");
  } catch (e) {
    return `ERR:${e.message}`;
  }
}

function parseRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const block = m[1];
    const title = (block.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "")
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<[^>]+>/g, " ")
      .trim();
    const desc = (block.match(/<description>([\s\S]*?)<\/description>/)?.[1] || "")
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<[^>]+>/g, " ")
      .trim()
      .slice(0, 280);
    return { title, desc };
  });
}

const queries = {
  gnews: [
    "南電 目標價 when:5y",
    "南電(8046) 目標價 when:5y",
    "8046 目標價 when:5y",
    "南電 外資 目標價 when:5y",
    "楠梓電子 目標價 when:5y",
  ],
  bing: ["南電 目標價", "8046 目標價", "南電 目標價 外資"],
  cnyes: ["南電目標價", "南電 目標價", "南電 外資 目標價", "南電 目標價 大和"],
};

async function main() {
  console.log("=== LIVE SOURCE PROBE 8046 南電 ===\n");

  for (const q of queries.gnews) {
    const url =
      "https://news.google.com/rss/search?" +
      `q=${encodeURIComponent(q)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
    const xml = await curlGet(url, 16);
    const items = xml.startsWith("ERR:") ? [] : parseRss(xml);
    console.log(`[gnews] q=${q} items=${items.length}`);
    for (const it of items.slice(0, 5)) {
      console.log(`  - ${it.title.slice(0, 120)}`);
      if (/目標|EPS|元|大和|高盛|美銀|花旗|大摩|美林/.test(it.title + it.desc)) {
        console.log(`    desc: ${it.desc.slice(0, 160)}`);
      }
    }
  }

  for (const q of queries.bing) {
    const url =
      "https://www.bing.com/news/search?" +
      `q=${encodeURIComponent(q)}&format=rss&mkt=zh-TW`;
    const xml = await curlGet(url, 14);
    const items = xml.startsWith("ERR:") ? [] : parseRss(xml);
    console.log(`[bing] q=${q} items=${items.length}`);
    for (const it of items.slice(0, 5)) {
      console.log(`  - ${it.title.slice(0, 120)}`);
    }
  }

  for (const q of queries.cnyes) {
    const url =
      "https://api.cnyes.com/media/api/v1/search?" +
      `q=${encodeURIComponent(q)}&limit=8`;
    const raw = await curlGet(url, 12);
    let items = [];
    try {
      items = JSON.parse(raw)?.items?.data ?? [];
    } catch {
      console.log(`[cnyes] q=${q} PARSE_FAIL ${raw.slice(0, 80)}`);
      continue;
    }
    console.log(`[cnyes] q=${q} items=${items.length}`);
    for (const it of items.slice(0, 5)) {
      console.log(`  - ${(it.title || "").slice(0, 120)}`);
    }
  }

  // Sample extract on known roundup text
  const sample =
    "不過綜合外資看法，日系外資大和資本看好市場對於ABF載板需求暢旺，給予目標價到2460元；摩根士丹利（大摩）、美銀、高盛、花旗等則分別給到1550元、1700元、2500元及1600元。";
  console.log("\n=== SAMPLE ROUNDUP TEXT ===");
  console.log(sample);

  // Price sanity vs ~1055
  const last = 1055;
  const targets = [2460, 1550, 1700, 2500, 1600, 2444, 2310, 1700];
  console.log(`\n=== SANITY vs last=${last} (0.3x..6x = ${last * 0.3}..${last * 6}) ===`);
  for (const t of targets) {
    const ok = t >= last * 0.3 && t <= last * 6;
    console.log(`  ${t}: ${ok ? "OK" : "DROP"}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
