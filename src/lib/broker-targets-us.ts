/**
 * 美股券商目標價＋預估 EPS（逐家）。
 *
 * 來源（合併、依券商去重保留最新）：
 * 1) Yahoo Finance upgradeDowngradeHistory（USD 目標價，主來源）
 * 2) Google News RSS（en-US／zh-TW，ticker＋price target）
 * 3) Bing News RSS（en-US）＋文章內文／og
 *
 * 快取：us/fundamentals-broker-targets.json；有資料 TTL 24h、空結果 45m。
 */

import type { BrokerTargetPrice, BrokerTargetsPayload } from "@/lib/broker-targets";
import { getYahooCrumbAuth, yahooAuthedGet } from "@/lib/yahoo-crumb";
import { readUsCacheFile, writeUsCacheFile } from "@/lib/us-market";

export type { BrokerTargetPrice, BrokerTargetsPayload };

type TargetsCache = {
  builtAt: string;
  byCode: Record<string, BrokerTargetsPayload>;
};

const CACHE = "fundamentals-broker-targets.json";
const TTL_HIT_MS = 24 * 60 * 60 * 1000;
const TTL_EMPTY_MS = 45 * 60 * 1000;
const STALE_SERVE_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_BUDGET_MS = 14_000;
const MAX_PAGE_FETCHES = 6;

type BrokerAlias = {
  display: string;
  kind: "domestic" | "foreign";
  aliases: string[];
};

/** 美股報道常見外資／投行（顯示名與台股對齊） */
const US_BROKER_ALIASES: BrokerAlias[] = [
  {
    display: "摩根士丹利",
    kind: "foreign",
    aliases: ["Morgan Stanley", "摩根士丹利", "大摩"],
  },
  {
    display: "摩根大通",
    kind: "foreign",
    aliases: ["JPMorgan", "J.P. Morgan", "JP Morgan", "摩根大通", "小摩"],
  },
  {
    display: "美銀",
    kind: "foreign",
    aliases: [
      "Bank of America",
      "BofA",
      "B of A",
      "BofA Securities",
      "Merrill",
      "美銀",
    ],
  },
  {
    display: "高盛",
    kind: "foreign",
    aliases: ["Goldman Sachs", "Goldman", "高盛"],
  },
  {
    display: "花旗",
    kind: "foreign",
    aliases: ["Citigroup", "Citi", "花旗"],
  },
  {
    display: "瑞銀",
    kind: "foreign",
    aliases: ["UBS", "瑞銀"],
  },
  {
    display: "麥格理",
    kind: "foreign",
    aliases: ["Macquarie", "麥格理"],
  },
  {
    display: "野村",
    kind: "foreign",
    aliases: ["Nomura", "野村"],
  },
  {
    display: "匯豐",
    kind: "foreign",
    aliases: ["HSBC", "匯豐"],
  },
  {
    display: "巴克萊",
    kind: "foreign",
    aliases: ["Barclays", "巴克萊"],
  },
  {
    display: "傑富瑞",
    kind: "foreign",
    aliases: ["Jefferies", "傑富瑞"],
  },
  {
    display: "大和",
    kind: "foreign",
    aliases: ["Daiwa", "大和"],
  },
  {
    display: "德銀",
    kind: "foreign",
    aliases: ["Deutsche Bank", "Deutsche", "德銀"],
  },
  {
    display: "伯恩斯坦",
    kind: "foreign",
    aliases: ["Bernstein", "伯恩斯坦"],
  },
  {
    display: "Needham",
    kind: "foreign",
    aliases: ["Needham"],
  },
  {
    display: "Stifel",
    kind: "foreign",
    aliases: ["Stifel"],
  },
  {
    display: "Wells Fargo",
    kind: "foreign",
    aliases: ["Wells Fargo", "Wells"],
  },
  {
    display: "RBC",
    kind: "foreign",
    aliases: ["RBC Capital", "RBC"],
  },
  {
    display: "Piper Sandler",
    kind: "foreign",
    aliases: ["Piper Sandler", "Piper"],
  },
  {
    display: "Wedbush",
    kind: "foreign",
    aliases: ["Wedbush"],
  },
  {
    display: "Raymond James",
    kind: "foreign",
    aliases: ["Raymond James"],
  },
  {
    display: "Mizuho",
    kind: "foreign",
    aliases: ["Mizuho"],
  },
  {
    display: "Cantor",
    kind: "foreign",
    aliases: ["Cantor Fitzgerald", "Cantor"],
  },
  {
    display: "Truist",
    kind: "foreign",
    aliases: ["Truist"],
  },
  {
    display: "Evercore",
    kind: "foreign",
    aliases: ["Evercore ISI", "Evercore"],
  },
  {
    display: "Oppenheimer",
    kind: "foreign",
    aliases: ["Oppenheimer"],
  },
];

const BROKER_OR_EN =
  "Goldman OR Morgan Stanley OR JPMorgan OR BofA OR Citi OR UBS OR Barclays OR Jefferies OR Wells Fargo OR Needham OR Wedbush";

const round2 = (n: number) => Math.round(n * 100) / 100;
const round0 = (n: number) => Math.round(n);

const stripHtml = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

function decodeXml(s: string) {
  return stripHtml(
    s
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">"),
  );
}

function unwrapNewsUrl(link: string): string {
  if (!link) return link;
  const raw = link.replace(/&amp;/g, "&").trim();
  try {
    const u = new URL(raw);
    if (/(^|\.)bing\.com$/i.test(u.hostname) && u.pathname.includes("apiclick")) {
      const inner = u.searchParams.get("url");
      if (inner && /^https?:\/\//i.test(inner)) return inner;
    }
  } catch {
    /* keep */
  }
  const m = raw.match(/[?&]url=(https?[^&]+)/i);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }
  return raw;
}

function findBroker(text: string): BrokerAlias | null {
  let best: { alias: BrokerAlias; len: number } | null = null;
  for (const b of US_BROKER_ALIASES) {
    for (const a of b.aliases) {
      if (text.includes(a) && (!best || a.length > best.len)) {
        best = { alias: b, len: a.length };
      }
    }
  }
  return best?.alias ?? null;
}

function toYmd(epochSec: number | null | undefined): string | null {
  if (epochSec == null || !Number.isFinite(epochSec)) return null;
  const d = new Date(epochSec * 1000);
  if (!Number.isFinite(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function pubDateToYmd(pubDate: string): string | null {
  const t = Date.parse(pubDate);
  if (!Number.isFinite(t)) return null;
  return toYmd(Math.floor(t / 1000));
}

function parseUsdToken(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").replace(/\$/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 1 || n > 100000) return null;
  return n;
}

function parseEpsToken(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").replace(/\$/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0 || n > 2000) return null;
  return round2(n);
}

/**
 * 英文／中英混排新聞：券商 + price target / EPS。
 */
export function extractUsBrokerTargetsFromText(
  text: string,
  options?: {
    asOf?: string | null;
    source?: string | null;
    url?: string | null;
    stockHints?: string[];
  },
): BrokerTargetPrice[] {
  const clean = stripHtml(text).replace(/(\d),(\d{3})(?!\d)/g, "$1$2");
  const hasTarget =
    /price\s*target|\bPT\b|目標[股]?價|target\s*(?:price|to)\b/i.test(clean);
  const hasEps = /\bEPS\b|earnings\s*(?:per\s*share|estimate)|每股盈[餘余]/i.test(
    clean,
  );
  if (!hasTarget && !hasEps) return [];

  type Acc = {
    broker: BrokerAlias;
    target: number | null;
    eps: number | null;
    epsYear: string | null;
    snippetFrom: number;
    snippetTo: number;
  };
  const byDisplay = new Map<string, Acc>();

  const ensure = (broker: BrokerAlias, from: number, to: number): Acc => {
    let row = byDisplay.get(broker.display);
    if (!row) {
      row = {
        broker,
        target: null,
        eps: null,
        epsYear: null,
        snippetFrom: from,
        snippetTo: to,
      };
      byDisplay.set(broker.display, row);
    } else {
      row.snippetFrom = Math.min(row.snippetFrom, from);
      row.snippetTo = Math.max(row.snippetTo, to);
    }
    return row;
  };

  const hints = (options?.stockHints ?? []).filter((h) => h && h.length >= 1);
  const relevant =
    !hints.length ||
    hints.some((h) => clean.toLowerCase().includes(h.toLowerCase()));
  if (!relevant) return [];

  let m: RegExpExecArray | null;

  // A) Firm raises/cuts/sets/lifts price target to $N
  const rePtTo =
    /([A-Za-z][A-Za-z.&'\s]{1,40}?)\s+(?:raises?|cuts?|sets?|lifts?|boosts?|hikes?|lowers?|maintains?|reiterates?|initiates?)\s+(?:its\s+)?(?:price\s*target|PT)\s+(?:to|at)\s*\$?\s*([0-9]{1,5}(?:\.[0-9]+)?)/gi;
  while ((m = rePtTo.exec(clean))) {
    const broker = findBroker(m[1]) || findBroker(m[0]);
    const price = parseUsdToken(m[2]);
    if (!broker || price == null) continue;
    const row = ensure(broker, m.index, m.index + m[0].length);
    if (row.target == null) row.target = price >= 100 ? round0(price) : round2(price);
  }

  // B) Firm PT $N / price target of $N
  const rePtOf =
    /([A-Za-z][A-Za-z.&'\s]{1,40}?)\s+(?:price\s*target|PT)\s+(?:of|at|:)?\s*\$?\s*([0-9]{1,5}(?:\.[0-9]+)?)/gi;
  while ((m = rePtOf.exec(clean))) {
    const broker = findBroker(m[1]) || findBroker(m[0]);
    const price = parseUsdToken(m[2]);
    if (!broker || price == null) continue;
    const row = ensure(broker, m.index, m.index + m[0].length);
    if (row.target == null) row.target = price >= 100 ? round0(price) : round2(price);
  }

  // C) 中文目標價句（台媒報美股）
  const reZh =
    /(高盛|美銀|大摩|小摩|摩根士丹利|摩根大通|花旗|瑞銀|傑富瑞|巴克萊)[^0-9]{0,40}?目標[股]?價[^0-9]{0,20}?(?:至|到|為|上看|喊)?\s*([0-9]{1,5}(?:\.[0-9]+)?)\s*(?:美元|美金|元)?/g;
  while ((m = reZh.exec(clean))) {
    const broker = findBroker(m[1]);
    const price = parseUsdToken(m[2]);
    if (!broker || price == null) continue;
    const row = ensure(broker, m.index, m.index + m[0].length);
    if (row.target == null) row.target = price >= 100 ? round0(price) : round2(price);
  }

  // D) EPS estimate to $N
  const reEps =
    /([A-Za-z][A-Za-z.&'\s]{1,40}?)[^.]{0,48}?(?:FY\s*20[2-3][0-9]|fiscal\s*20[2-3][0-9]|next\s*year|CY\s*20[2-3][0-9])?[^.]{0,24}?(?:EPS|earnings\s*(?:per\s*share)?)\s*(?:estimate|est\.?|forecast)?[^0-9$]{0,20}?(?:to|at|:)\s*\$?\s*([0-9]{1,4}(?:\.[0-9]+)?)/gi;
  while ((m = reEps.exec(clean))) {
    const broker = findBroker(m[1]) || findBroker(m[0]);
    const eps = parseEpsToken(m[2]);
    if (!broker || eps == null) continue;
    const yearSlice = m[0];
    let epsYear: string | null = null;
    const y = yearSlice.match(/20[2-3][0-9]/);
    if (y) epsYear = y[0];
    else if (/next\s*year/i.test(yearSlice)) epsYear = "明年";
    const row = ensure(broker, m.index, m.index + m[0].length);
    if (row.eps == null) {
      row.eps = eps;
      row.epsYear = epsYear;
    }
  }

  // E) 單券商全文＋任意 PT $N
  if (![...byDisplay.values()].some((r) => r.target != null)) {
    const broker = findBroker(clean);
    const pm = clean.match(
      /(?:price\s*target|PT|目標[股]?價)[^0-9$]{0,24}\$?\s*([0-9]{1,5}(?:\.[0-9]+)?)/i,
    );
    if (broker && pm) {
      const price = parseUsdToken(pm[1]);
      if (price != null) {
        const row = ensure(broker, 0, Math.min(120, clean.length));
        if (row.target == null) {
          row.target = price >= 100 ? round0(price) : round2(price);
        }
      }
    }
  }

  const out: BrokerTargetPrice[] = [];
  for (const row of byDisplay.values()) {
    if (row.target == null && row.eps == null) continue;
    out.push({
      broker: row.broker.display,
      target: row.target,
      eps: row.eps,
      epsYear: row.epsYear,
      asOf: options?.asOf ?? null,
      kind: row.broker.kind,
      source: options?.source ?? "news",
      snippet: clean.slice(
        Math.max(0, row.snippetFrom),
        Math.min(clean.length, row.snippetTo),
      ),
      url: options?.url ?? null,
    });
  }
  return out;
}

function mergeTarget(
  byBroker: Map<string, BrokerTargetPrice>,
  row: BrokerTargetPrice,
) {
  const prev = byBroker.get(row.broker);
  if (!prev) {
    byBroker.set(row.broker, { ...row });
    return;
  }
  const newer =
    row.asOf && prev.asOf
      ? row.asOf > prev.asOf
      : Boolean(row.asOf && !prev.asOf);
  const sameDay =
    row.asOf && prev.asOf && row.asOf === prev.asOf
      ? true
      : !row.asOf && !prev.asOf;
  const merged: BrokerTargetPrice = { ...prev };
  if (newer) {
    if (row.target != null) merged.target = row.target;
    if (row.eps != null) {
      merged.eps = row.eps;
      merged.epsYear = row.epsYear ?? merged.epsYear ?? null;
    }
    merged.asOf = row.asOf ?? merged.asOf;
    merged.source = row.source ?? merged.source;
    merged.snippet = row.snippet ?? merged.snippet;
    merged.url = row.url ?? merged.url;
    merged.kind = row.kind ?? merged.kind;
  } else if (sameDay || !prev.asOf) {
    if (merged.target == null && row.target != null) merged.target = row.target;
    if (merged.eps == null && row.eps != null) {
      merged.eps = row.eps;
      merged.epsYear = row.epsYear ?? null;
    }
    if (!merged.url && row.url) merged.url = row.url;
    if (!merged.snippet && row.snippet) merged.snippet = row.snippet;
    if (!merged.source && row.source) merged.source = row.source;
    if (!merged.asOf && row.asOf) merged.asOf = row.asOf;
  } else {
    if (merged.target == null && row.target != null) merged.target = row.target;
    if (merged.eps == null && row.eps != null) {
      merged.eps = row.eps;
      merged.epsYear = row.epsYear ?? null;
    }
  }
  byBroker.set(row.broker, merged);
}

async function curlGet(url: string, timeoutSec = 16): Promise<string> {
  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const run = promisify(execFile);
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
  } catch {
    return "";
  }
}

type NewsItem = {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  description?: string;
};

function parseRssItems(xml: string): NewsItem[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const block = m[1];
    const descRaw =
      block.match(/<description>([\s\S]*?)<\/description>/)?.[1] || "";
    const linkRaw = block.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "";
    return {
      title: decodeXml(block.match(/<title>([\s\S]*?)<\/title>/)?.[1] || ""),
      link: unwrapNewsUrl(decodeXml(linkRaw) || linkRaw.replace(/&amp;/g, "&")),
      pubDate: block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "",
      source: decodeXml(
        block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || "",
      ),
      description: decodeXml(descRaw),
    };
  });
}

async function googleNewsSearch(q: string, locale: "en" | "zh"): Promise<NewsItem[]> {
  const url =
    locale === "zh"
      ? "https://news.google.com/rss/search?" +
        `q=${encodeURIComponent(q)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`
      : "https://news.google.com/rss/search?" +
        `q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
  const xml = await curlGet(url, 16);
  return parseRssItems(xml);
}

async function bingNewsSearch(q: string): Promise<NewsItem[]> {
  const url =
    "https://www.bing.com/news/search?" +
    `q=${encodeURIComponent(q)}&format=rss&mkt=en-US`;
  const xml = await curlGet(url, 14);
  return parseRssItems(xml);
}

async function fetchPageHint(url: string): Promise<string> {
  if (!url || !/^https?:\/\//i.test(url)) return "";
  try {
    const html = await curlGet(url, 12);
    if (!html || html.length < 40) return "";
    const og =
      html.match(/property="og:description"\s+content="([^"]+)"/)?.[1] ||
      html.match(/content="([^"]+)"\s+property="og:description"/)?.[1] ||
      html.match(/name="description"\s+content="([^"]+)"/)?.[1] ||
      "";
    const title =
      html.match(/property="og:title"\s+content="([^"]+)"/)?.[1] ||
      html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
      "";
    const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((m) => stripHtml(m[1]))
      .filter(
        (p) =>
          p.length >= 24 &&
          p.length < 800 &&
          /price\s*target|\bPT\b|\bEPS\b|目標[股]?價|raises?|cuts?/i.test(p),
      )
      .slice(0, 6);
    return [decodeXml(title), decodeXml(og), ...paras]
      .filter(Boolean)
      .join("\n")
      .slice(0, 5000);
  } catch {
    return "";
  }
}

function stockHints(code: string, name: string): string[] {
  const out = new Set<string>();
  out.add(code.toUpperCase());
  const n = name.trim();
  if (n) {
    out.add(n);
    const first = n.split(/[（(/]/)[0]?.trim();
    if (first && first.length >= 2) out.add(first);
    const brand = first?.split(/[\s,]+/)[0];
    if (brand && brand.length >= 2) out.add(brand);
  }
  return [...out];
}

function relevantToStock(blob: string, code: string, name: string): boolean {
  const t = stripHtml(blob);
  const upper = t.toUpperCase();
  if (upper.includes(code.toUpperCase())) return true;
  for (const h of stockHints(code, name)) {
    if (h.length >= 2 && t.toLowerCase().includes(h.toLowerCase())) return true;
  }
  return false;
}

type PageFetchCandidate = {
  url: string;
  asOf: string | null;
  source: string;
  priority: number;
};

function ingestNewsItems(
  items: NewsItem[],
  code: string,
  name: string,
  byBroker: Map<string, BrokerTargetPrice>,
  sourcePrefix: string,
  seenTitles: Set<string>,
  pageCandidates: PageFetchCandidate[],
) {
  const hints = stockHints(code, name);
  for (const item of items) {
    if (!item.title || seenTitles.has(item.title)) continue;
    seenTitles.add(item.title);
    const blob = `${item.title}\n${item.description || ""}`;
    if (!relevantToStock(blob, code, name)) continue;
    if (
      !/price\s*target|\bPT\b|\bEPS\b|目標[股]?價|\$[0-9]/i.test(blob) &&
      !findBroker(blob)
    ) {
      continue;
    }
    const asOf = pubDateToYmd(item.pubDate);
    const found = extractUsBrokerTargetsFromText(blob, {
      asOf,
      source: item.source ? `${sourcePrefix}:${item.source}` : sourcePrefix,
      url: item.link || null,
      stockHints: hints,
    });
    for (const row of found) mergeTarget(byBroker, row);

    const wantsBody =
      Boolean(item.link) &&
      !/news\.google\.com/i.test(item.link) &&
      (/price\s*target|\bPT\b|目標|raises?|cuts?|EPS/i.test(item.title) ||
        found.length < 2 ||
        !found.some((r) => r.target != null));
    if (wantsBody && item.link) {
      let priority = 0;
      if (/price\s*target|\bPT\b|目標/i.test(item.title)) priority += 3;
      if (findBroker(item.title)) priority += 2;
      if (found.length === 0) priority += 2;
      pageCandidates.push({
        url: item.link,
        asOf,
        source: item.source
          ? `${sourcePrefix}-page:${item.source}`
          : `${sourcePrefix}-page`,
        priority,
      });
    }
  }
}

async function enrichFromArticlePages(
  candidates: PageFetchCandidate[],
  code: string,
  name: string,
  byBroker: Map<string, BrokerTargetPrice>,
) {
  if (!candidates.length) return;
  const hints = stockHints(code, name);
  const seen = new Set<string>();
  const ranked = [...candidates]
    .sort((a, b) => b.priority - a.priority)
    .filter((c) => {
      if (!c.url || seen.has(c.url) || /news\.google\.com/i.test(c.url)) {
        return false;
      }
      seen.add(c.url);
      return true;
    })
    .slice(0, MAX_PAGE_FETCHES);

  const pages = await Promise.all(
    ranked.map(async (c) => ({ ...c, text: await fetchPageHint(c.url) })),
  );
  for (const page of pages) {
    if (!page.text || page.text.length < 20) continue;
    if (!relevantToStock(page.text, code, name)) continue;
    const found = extractUsBrokerTargetsFromText(page.text, {
      asOf: page.asOf,
      source: page.source,
      url: page.url,
      stockHints: hints,
    });
    for (const row of found) mergeTarget(byBroker, row);
  }
}

async function collectFromNews(
  code: string,
  name: string,
): Promise<BrokerTargetPrice[]> {
  const byBroker = new Map<string, BrokerTargetPrice>();
  const hints = stockHints(code, name);
  const nameMain = hints.find((h) => h !== code) || name || code;
  const queriesEn = [
    `${code} price target`,
    `"${nameMain}" price target`,
    `${code} price target ${BROKER_OR_EN}`,
    `${code} raises price target`,
    `${code} PT Goldman OR Jefferies OR BofA`,
  ];
  const queriesZh = [
    `${code} 目標價`,
    `${nameMain} 目標價`,
    `${code} 目標價 高盛 OR 美銀 OR 大摩`,
  ];
  const seenTitles = new Set<string>();
  const pageCandidates: PageFetchCandidate[] = [];
  const batches = await Promise.all([
    ...queriesEn.map((q) => googleNewsSearch(q, "en").catch(() => [] as NewsItem[])),
    ...queriesZh.map((q) => googleNewsSearch(q, "zh").catch(() => [] as NewsItem[])),
    ...queriesEn.slice(0, 3).map((q) => bingNewsSearch(q).catch(() => [] as NewsItem[])),
  ]);
  for (const items of batches) {
    ingestNewsItems(
      items,
      code,
      name,
      byBroker,
      "gnews",
      seenTitles,
      pageCandidates,
    );
  }
  await enrichFromArticlePages(pageCandidates, code, name, byBroker);
  return [...byBroker.values()];
}

async function collectFromYahooUs(
  code: string,
): Promise<BrokerTargetPrice[]> {
  const byBroker = new Map<string, BrokerTargetPrice>();
  const auth = await getYahooCrumbAuth();
  if (!auth) return [];
  try {
    const hosts = [
      "https://query2.finance.yahoo.com",
      "https://query1.finance.yahoo.com",
    ];
    let hist: Array<{
      epochGradeDate?: number;
      firm?: string;
      currentPriceTarget?: number;
    }> = [];
    for (const host of hosts) {
      const url =
        `${host}/v10/finance/quoteSummary/${encodeURIComponent(code)}` +
        `?modules=upgradeDowngradeHistory,financialData`;
      const raw = await yahooAuthedGet(url, auth);
      if (!raw) continue;
      const data = JSON.parse(raw) as {
        quoteSummary?: {
          result?: Array<{
            upgradeDowngradeHistory?: {
              history?: Array<{
                epochGradeDate?: number;
                firm?: string;
                currentPriceTarget?: number;
              }>;
            };
          }>;
        };
      };
      hist =
        data.quoteSummary?.result?.[0]?.upgradeDowngradeHistory?.history ?? [];
      if (hist.length) break;
    }
    for (const h of hist) {
      if (h.currentPriceTarget == null || !h.firm) continue;
      const broker = findBroker(h.firm);
      if (!broker) continue;
      const target = h.currentPriceTarget;
      if (!Number.isFinite(target) || target < 1 || target > 100000) continue;
      mergeTarget(byBroker, {
        broker: broker.display,
        target: target >= 100 ? round0(target) : round2(target),
        eps: null,
        asOf: toYmd(h.epochGradeDate ?? null),
        kind: broker.kind,
        source: `yahoo-us:${code}`,
        snippet: `${h.firm} PT $${target}`,
        url: `https://finance.yahoo.com/quote/${encodeURIComponent(code)}/analysis/`,
      });
    }
  } catch {
    /* optional */
  }
  return [...byBroker.values()];
}

function isPlausibleUsTarget(target: number, last: number | null): boolean {
  if (!Number.isFinite(target) || target < 1) return false;
  if (last == null || !(last > 0)) return target >= 2;
  return target >= last * 0.25 && target <= last * 5;
}

function isPlausibleUsEps(eps: number, last: number | null): boolean {
  if (!Number.isFinite(eps) || eps <= 0 || eps > 2000) return false;
  if (last != null && last > 0 && eps > last * 1.5 && eps > 200) return false;
  return true;
}

function withBudget<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(null);
    }, ms);
    p.then(
      (v) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(v);
      },
      () => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(null);
      },
    );
  });
}

function usBrokerFlightBag() {
  const g = globalThis as typeof globalThis & {
    __jinliuUsBrokerTargetsFlight?: Map<string, Promise<BrokerTargetsPayload>>;
    __jinliuUsBrokerTargetsMemo?: Map<
      string,
      { at: number; value: BrokerTargetsPayload }
    >;
  };
  if (!g.__jinliuUsBrokerTargetsFlight) {
    g.__jinliuUsBrokerTargetsFlight = new Map();
  }
  if (!g.__jinliuUsBrokerTargetsMemo) {
    g.__jinliuUsBrokerTargetsMemo = new Map();
  }
  return {
    flight: g.__jinliuUsBrokerTargetsFlight,
    memo: g.__jinliuUsBrokerTargetsMemo,
  };
}

function normalizeUsCode(code: string) {
  return code.trim().toUpperCase();
}

function isUsTicker(code: string) {
  return /^[A-Z]{1,5}(\.[A-Z])?$/.test(normalizeUsCode(code));
}

async function scrapeUsBrokerTargetPrices(
  stockCode: string,
  name: string,
): Promise<BrokerTargetsPayload> {
  let cache =
    (await readUsCacheFile<TargetsCache>(CACHE)) ?? {
      builtAt: "",
      byCode: {},
    };

  const byBroker = new Map<string, BrokerTargetPrice>();
  const [yahooRows, newsRows] = await Promise.all([
    withBudget(
      collectFromYahooUs(stockCode).catch(() => [] as BrokerTargetPrice[]),
      FETCH_BUDGET_MS,
    ),
    withBudget(
      collectFromNews(stockCode, name).catch(() => [] as BrokerTargetPrice[]),
      FETCH_BUDGET_MS,
    ),
  ]);

  for (const batch of [yahooRows, newsRows]) {
    if (!batch) continue;
    for (const row of batch) mergeTarget(byBroker, row);
  }

  // last price：用 Yahoo chart 粗估可不擋；略過嚴格比價時用 null
  const lastPrice: number | null = null;
  const targets = [...byBroker.values()]
    .map((t) => {
      const next = { ...t };
      if (next.target != null && !isPlausibleUsTarget(next.target, lastPrice)) {
        next.target = null;
      }
      if (next.eps != null && !isPlausibleUsEps(next.eps, lastPrice)) {
        next.eps = null;
        next.epsYear = null;
      }
      return next;
    })
    .filter((t) => t.target != null || t.eps != null)
    .sort(
      (a, b) =>
        (b.target ?? -1) - (a.target ?? -1) ||
        (b.eps ?? -1) - (a.eps ?? -1) ||
        (b.asOf ?? "").localeCompare(a.asOf ?? "") ||
        a.broker.localeCompare(b.broker, "zh-Hant"),
    );

  const sources = new Set(
    targets.map((t) => (t.source ?? "").split(":")[0]).filter(Boolean),
  );
  const payload: BrokerTargetsPayload = {
    code: stockCode,
    name,
    targets,
    builtAt: new Date().toISOString(),
    source: sources.size ? [...sources].sort().join("+") : "multi",
    emptyReason: targets.length
      ? null
      : "近數年公開新聞／Yahoo 未解析到具名券商目標價或預估 EPS",
  };

  const prev = cache.byCode[stockCode];
  if (
    !targets.length &&
    prev?.targets?.length &&
    Date.now() - Date.parse(prev.builtAt || "") < STALE_SERVE_MS
  ) {
    const { memo } = usBrokerFlightBag();
    memo.set(stockCode, { at: Date.now(), value: prev });
    return prev;
  }

  cache.byCode[stockCode] = payload;
  cache.builtAt = new Date().toISOString();
  await writeUsCacheFile(CACHE, cache).catch(() => null);
  const { memo } = usBrokerFlightBag();
  memo.set(stockCode, { at: Date.now(), value: payload });
  return payload;
}

export async function getUsBrokerTargetPrices(
  code: string,
  options?: { name?: string | null; force?: boolean },
): Promise<BrokerTargetsPayload> {
  const stockCode = normalizeUsCode(code);
  const name = (options?.name ?? "").trim() || stockCode;
  const empty = (reason: string): BrokerTargetsPayload => ({
    code: stockCode,
    name,
    targets: [],
    builtAt: new Date().toISOString(),
    source: "multi",
    emptyReason: reason,
  });

  if (!isUsTicker(stockCode)) {
    return empty("代號格式不符");
  }

  const { flight, memo } = usBrokerFlightBag();

  if (!options?.force) {
    const mem = memo.get(stockCode);
    if (mem && Date.now() - mem.at < TTL_HIT_MS) {
      const age = Date.now() - Date.parse(mem.value.builtAt || "");
      const ttlUse = mem.value.targets?.length ? TTL_HIT_MS : TTL_EMPTY_MS;
      if (Number.isFinite(age) && age >= 0 && age < ttlUse) {
        return mem.value;
      }
    }
  }

  const cache =
    (await readUsCacheFile<TargetsCache>(CACHE)) ?? {
      builtAt: "",
      byCode: {},
    };
  const cached = cache.byCode[stockCode];
  if (!options?.force && cached?.builtAt) {
    const age = Date.now() - Date.parse(cached.builtAt);
    const ttl = cached.targets?.length ? TTL_HIT_MS : TTL_EMPTY_MS;
    if (Number.isFinite(age) && age >= 0 && age < ttl) {
      memo.set(stockCode, { at: Date.now(), value: cached });
      return cached;
    }
    if (
      Number.isFinite(age) &&
      age >= 0 &&
      age < STALE_SERVE_MS &&
      (cached.targets?.length || age < TTL_EMPTY_MS * 6)
    ) {
      memo.set(stockCode, { at: Date.now(), value: cached });
      if (!flight.has(stockCode)) {
        const p = scrapeUsBrokerTargetPrices(
          stockCode,
          cached.name || name,
        ).finally(() => flight.delete(stockCode));
        flight.set(stockCode, p);
      }
      return cached;
    }
  }

  const existing = flight.get(stockCode);
  if (existing && !options?.force) return existing;

  const p = scrapeUsBrokerTargetPrices(stockCode, name).finally(() =>
    flight.delete(stockCode),
  );
  flight.set(stockCode, p);
  return p;
}
