/**
 * 內外資券商目標價（逐家，非 FactSet 共識彙總）。
 *
 * 來源（合併、依券商去重保留最新）：
 * 1) Google News RSS：標題常含「高盛喊 7000」「美銀給…目標價 750」
 * 2) 鉅亨新聞（Cnyes）搜尋＋文章 og:description
 * 3) Yahoo Finance ADR upgradeDowngradeHistory（少數有 ADR 的標的，換算成台幣）
 *
 * Goodinfo 等表格式來源有 Cloudflare，伺服器端無法穩抓。
 * 快取：fundamentals-broker-targets.json；有資料 TTL 24h、空結果 3h。
 * 展開／查詢時懶加載，不在日終同步批次抓取。
 */

import {
  fetchJson,
  fetchJsonViaCurl,
  readCacheFile,
  writeCacheFile,
} from "@/lib/tw-market";

export type BrokerTargetPrice = {
  /** 券商／外資顯示名 */
  broker: string;
  /** 目標價（元，台幣） */
  target: number;
  /** 報道／估計日 YYYY-MM-DD */
  asOf?: string | null;
  /** domestic | foreign | unknown */
  kind?: "domestic" | "foreign" | "unknown";
  /** 來源標籤 */
  source?: string | null;
  /** 原文片段（除錯／溯源） */
  snippet?: string | null;
  /** 可點來源連結（新聞／Yahoo 等） */
  url?: string | null;
};

export type BrokerTargetsPayload = {
  code: string;
  name: string;
  targets: BrokerTargetPrice[];
  builtAt: string;
  source: string;
  emptyReason?: string | null;
};

type TargetsCache = {
  builtAt: string;
  byCode: Record<string, BrokerTargetsPayload>;
};

const CACHE = "fundamentals-broker-targets.json";
const TTL_HIT_MS = 24 * 60 * 60 * 1000;
const TTL_EMPTY_MS = 3 * 60 * 60 * 1000;

type BrokerAlias = {
  display: string;
  kind: "domestic" | "foreign";
  aliases: string[];
};

/** 常見內外資券商對照（顯示名優先用短稱） */
const BROKER_ALIASES: BrokerAlias[] = [
  {
    display: "摩根士丹利",
    kind: "foreign",
    aliases: ["摩根士丹利", "台灣摩根士丹利", "大摩", "Morgan Stanley"],
  },
  {
    display: "摩根大通",
    kind: "foreign",
    aliases: ["摩根大通", "小摩", "JPMorgan", "J.P. Morgan", "JP摩根", "JP 摩根"],
  },
  {
    display: "美銀",
    kind: "foreign",
    aliases: [
      "美銀",
      "美國銀行",
      "美銀證",
      "BofA",
      "Bank of America",
      "B of A Securities",
      "B of A",
    ],
  },
  {
    display: "高盛",
    kind: "foreign",
    aliases: ["高盛", "美商高盛", "Goldman", "Goldman Sachs"],
  },
  {
    display: "花旗",
    kind: "foreign",
    aliases: ["花旗", "花旗環球", "Citigroup", "Citi"],
  },
  {
    display: "瑞銀",
    kind: "foreign",
    aliases: ["瑞銀", "新加坡商瑞銀", "UBS"],
  },
  {
    display: "麥格理",
    kind: "foreign",
    aliases: ["麥格理", "港商麥格理", "Macquarie"],
  },
  {
    display: "野村",
    kind: "foreign",
    aliases: ["野村", "Nomura"],
  },
  {
    display: "匯豐",
    kind: "foreign",
    aliases: ["匯豐", "香港上海匯豐", "HSBC"],
  },
  {
    display: "巴克萊",
    kind: "foreign",
    aliases: ["巴克萊", "Barclays"],
  },
  {
    display: "傑富瑞",
    kind: "foreign",
    aliases: ["傑富瑞", "Jefferies"],
  },
  {
    display: "大和",
    kind: "foreign",
    aliases: ["大和", "大和國泰", "Daiwa"],
  },
  {
    display: "法巴",
    kind: "foreign",
    aliases: ["法巴", "法銀巴黎", "BNP"],
  },
  {
    display: "德銀",
    kind: "foreign",
    aliases: ["德銀", "德意志", "Deutsche"],
  },
  {
    display: "星展",
    kind: "foreign",
    aliases: ["星展", "DBS"],
  },
  {
    display: "美林",
    kind: "foreign",
    aliases: ["美林", "Merrill"],
  },
  {
    display: "里昂",
    kind: "foreign",
    aliases: ["里昂", "里昂證券", "Societe Generale", "Société Générale", "SocGen"],
  },
  {
    display: "伯恩斯坦",
    kind: "foreign",
    aliases: ["伯恩斯坦", "Bernstein"],
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
    display: "元大",
    kind: "domestic",
    aliases: ["元大", "元大證券", "元大投顧"],
  },
  {
    display: "凱基",
    kind: "domestic",
    aliases: ["凱基", "凱基證券", "凱基投顧"],
  },
  {
    display: "國泰",
    kind: "domestic",
    aliases: ["國泰證", "國泰證券", "國泰投顧"],
  },
  {
    display: "富邦",
    kind: "domestic",
    aliases: ["富邦", "富邦證券", "富邦投顧"],
  },
  {
    display: "群益",
    kind: "domestic",
    aliases: ["群益", "群益金鼎", "群益投顧"],
  },
  {
    display: "永豐",
    kind: "domestic",
    aliases: ["永豐", "永豐金", "永豐金證券", "永豐投顧"],
  },
  {
    display: "中信",
    kind: "domestic",
    aliases: ["中信", "中信證", "中國信託", "中信投顧"],
  },
  {
    display: "兆豐",
    kind: "domestic",
    aliases: ["兆豐", "兆豐證券", "兆豐投顧"],
  },
  {
    display: "統一",
    kind: "domestic",
    aliases: ["統一證", "統一證券", "統一投顧"],
  },
  {
    display: "台新",
    kind: "domestic",
    aliases: ["台新", "台新證券", "台新投顧"],
  },
  {
    display: "第一金",
    kind: "domestic",
    aliases: ["第一金", "第一金證", "第一金投顧"],
  },
  {
    display: "宏遠",
    kind: "domestic",
    aliases: ["宏遠", "宏遠證券", "宏遠投顧"],
  },
  {
    display: "本土投顧",
    kind: "domestic",
    aliases: ["本土投顧", "本土券商"],
  },
];

/** TW 代號 → Yahoo ADR（有逐家目標價時才有用） */
const ADR_BY_CODE: Record<string, string> = {
  "2330": "TSM",
};

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

const decodeXml = (s: string) =>
  stripHtml(
    s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"),
  );

const round0 = (n: number) => Math.round(n);

/** 解析「3,700」「2988」「7.5」等數字字串 */
function parsePriceToken(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").replace(/\s+/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 1 || n > 100000) return null;
  return n;
}

function toYmd(epochSec: number | null | undefined): string | null {
  if (epochSec == null || !Number.isFinite(epochSec)) return null;
  const d = new Date(epochSec * 1000);
  if (!Number.isFinite(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
}

function pubDateToYmd(pubDate: string): string | null {
  const t = Date.parse(pubDate);
  if (!Number.isFinite(t)) return null;
  return toYmd(Math.floor(t / 1000));
}

function findBroker(text: string): BrokerAlias | null {
  let best: { alias: BrokerAlias; len: number } | null = null;
  for (const b of BROKER_ALIASES) {
    for (const a of b.aliases) {
      if (text.includes(a) && (!best || a.length > best.len)) {
        best = { alias: b, len: a.length };
      }
    }
  }
  return best?.alias ?? null;
}

function findAllBrokers(text: string): BrokerAlias[] {
  const hits: { alias: BrokerAlias; len: number; idx: number }[] = [];
  for (const b of BROKER_ALIASES) {
    for (const a of b.aliases) {
      const idx = text.indexOf(a);
      if (idx >= 0) hits.push({ alias: b, len: a.length, idx });
    }
  }
  hits.sort((x, y) => y.len - x.len || x.idx - y.idx);
  const seen = new Set<string>();
  const out: BrokerAlias[] = [];
  for (const h of hits) {
    if (seen.has(h.alias.display)) continue;
    seen.add(h.alias.display);
    out.push(h.alias);
  }
  return out;
}

/**
 * 從中文新聞句／標題抽出「券商 + 目標價」。
 * 支援：目標價／目標股價、千分位逗號、喊／給／至／上看 等句型。
 * 「由 A 上調至 B」取 B；略過「目標價上調 370 元」這類調幅。
 */
export function extractBrokerTargetsFromText(
  text: string,
  options?: {
    asOf?: string | null;
    source?: string | null;
    url?: string | null;
  },
): BrokerTargetPrice[] {
  const clean = stripHtml(text)
    // 統一千分位：3,700 → 3700（保留小數）
    .replace(/(\d),(\d{3})/g, "$1$2");
  if (!/目標[股]?價/.test(clean)) return [];

  const out: BrokerTargetPrice[] = [];
  const seen = new Set<string>();

  const push = (
    broker: BrokerAlias,
    target: number,
    snippetFrom: number,
    snippetTo: number,
  ) => {
    if (!Number.isFinite(target) || target < 1 || target > 100000) return;
    // 台股目標價極端值過濾：低於 5 多半是誤抓比率／美元未換算
    if (target < 5) return;
    if (seen.has(broker.display)) return;
    seen.add(broker.display);
    out.push({
      broker: broker.display,
      target: round0(target),
      asOf: options?.asOf ?? null,
      kind: broker.kind,
      source: options?.source ?? "news",
      snippet: clean.slice(
        Math.max(0, snippetFrom),
        Math.min(clean.length, snippetTo),
      ),
      url: options?.url ?? null,
    });
  };

  const brokerNear = (index: number, span: number) => {
    // 優先取匹配點左側最近的券商，避免同一句多券商時誤配
    const left = clean.slice(Math.max(0, index - 56), index);
    let best: { alias: BrokerAlias; pos: number; len: number } | null = null;
    for (const b of BROKER_ALIASES) {
      for (const a of b.aliases) {
        const pos = left.lastIndexOf(a);
        if (pos < 0) continue;
        if (
          !best ||
          pos > best.pos ||
          (pos === best.pos && a.length > best.len)
        ) {
          best = { alias: b, pos, len: a.length };
        }
      }
    }
    if (best) return best.alias;
    const right = clean.slice(index, Math.min(clean.length, index + span + 40));
    return findBroker(right) || findBroker(clean);
  };

  let m: RegExpExecArray | null;

  // A) 優先：目標價…由 A …(上調|至|提升至) B → 取 B
  const reFromTo =
    /目標[股]?價[^。；;\n]{0,48}?由\s*[0-9.]+[^0-9]{0,20}?(?:上[調修升]|調[升降]|至|到|提升至)\s*([0-9]{2,5}(?:\.[0-9]+)?)/g;
  while ((m = reFromTo.exec(clean))) {
    const price = parsePriceToken(m[1]);
    if (price == null) continue;
    const broker = brokerNear(m.index, m[0].length);
    if (!broker) continue;
    push(broker, price, Math.max(0, m.index - 36), m.index + m[0].length);
  }

  // B) 目標價…(調升|上調|維持|上看)?…(至|到|為|看至|上看) N
  //    要求有「至／到／為／看」等錨點，避免吃到「由 N」
  const reToPrice =
    /目標[股]?價[^0-9由]{0,28}?(?:上[調修升]|調[升降]|下[調修]|維[持持]|上看)?[^0-9]{0,12}?(?:至|到|為|看至|上看)\s*([0-9]{2,5}(?:\.[0-9]+)?)\s*元?/g;
  while ((m = reToPrice.exec(clean))) {
    const price = parsePriceToken(m[1]);
    if (price == null) continue;
    const broker = brokerNear(m.index, m[0].length);
    if (!broker) continue;
    push(broker, price, Math.max(0, m.index - 36), m.index + m[0].length);
  }

  // C) 「高盛喊 7000」「美銀給…750」「里昂喊升…至 3700」「目標價 高盛喊到 7000」
  const reBrokerVerb =
    /(摩根士丹利|台灣摩根士丹利|大摩|摩根大通|小摩|美銀|美國銀行|高盛|花旗|瑞銀|麥格理|野村|匯豐|巴克萊|傑富瑞|大和|法巴|德銀|星展|美林|里昂證券|里昂|元大|凱基|國泰證|國泰證券|富邦|群益|永豐|中信|兆豐|統一證|台新|第一金|宏遠|本土投顧|本土券商|BofA|Goldman|UBS|Nomura|Citi|Bernstein|Needham|Stifel|Barclays|JPMorgan)[^0-9]{0,40}?(?:喊(?:到|上|出)?|給|上看|升至|調升至|調降至|上調至|下修至|目標[股]?價[^0-9由]{0,16}?(?:至|到|為|看|喊)?)[^0-9]{0,8}?([0-9]{2,5}(?:\.[0-9]+)?)\s*元?/g;
  while ((m = reBrokerVerb.exec(clean))) {
    const broker = findBroker(m[1]);
    const price = parsePriceToken(m[2]);
    if (!broker || price == null) continue;
    push(broker, price, m.index, m.index + m[0].length);
  }

  // D) 「大摩同步把目標價上看至1800」類：目標價上看／喊 N（已有券商於前文）
  const reLook =
    /目標[股]?價\s*(?:上看|喊(?:到|上|出)?)\s*(?:至|到)?\s*([0-9]{2,5}(?:\.[0-9]+)?)\s*元?/g;
  while ((m = reLook.exec(clean))) {
    const price = parsePriceToken(m[1]);
    if (price == null) continue;
    const broker = brokerNear(m.index, m[0].length);
    if (!broker) continue;
    push(broker, price, Math.max(0, m.index - 36), m.index + m[0].length);
  }

  // E) 全文僅一家券商＋任一絕對目標價（排除「由」後第一個數字）
  if (!out.length) {
    const brokers = findAllBrokers(clean);
    const fromTo = clean.match(
      /目標[股]?價[^。]{0,48}?由\s*[0-9.]+[^0-9]{0,20}?(?:上[調修升]|調[升降]|至|到|提升至)\s*([0-9]{2,5}(?:\.[0-9]+)?)/,
    );
    const pm = clean.match(
      /目標[股]?價[^0-9由]{0,24}(?:至|到|為|看至|上看|喊(?:到|上|出)?)?\s*([0-9]{2,5}(?:\.[0-9]+)?)/,
    );
    const raw = fromTo?.[1] ?? pm?.[1];
    if (brokers.length === 1 && raw) {
      // 丟棄純調幅：目標價上調370（無至）
      const delta =
        /目標[股]?價[^0-9]{0,8}(?:上[調修升]|調[升降]|下[調修]|砍)[^0-9至到看喊給為]{0,6}[0-9]/.test(
          clean,
        ) && !/(?:至|到|為|看|喊|給)/.test(clean);
      if (!delta) {
        const price = parsePriceToken(raw);
        if (price != null) {
          push(brokers[0], price, 0, Math.min(100, clean.length));
        }
      }
    }
  }

  return out;
}

type CnyesSearchItem = {
  newsId?: number;
  title?: string;
  content?: string;
  summary?: string;
  publishAt?: number;
  keyword?: string[];
};

async function cnyesSearch(q: string, limit = 12): Promise<CnyesSearchItem[]> {
  const url =
    "https://api.cnyes.com/media/api/v1/search?" +
    `q=${encodeURIComponent(q)}&limit=${limit}`;
  const payload =
    (await fetchJsonViaCurl<{
      items?: { data?: CnyesSearchItem[] };
    }>(url)) ??
    (await fetchJson<{
      items?: { data?: CnyesSearchItem[] };
    }>(url));
  return payload?.items?.data ?? [];
}

async function fetchArticleHint(newsId: number): Promise<string> {
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
        "Mozilla/5.0 (compatible; jinliu-bot/1.0)",
        "--max-time",
        "12",
        `https://news.cnyes.com/news/id/${newsId}`,
      ],
      { timeout: 15000, maxBuffer: 3 * 1024 * 1024 },
    );
    const html = String(stdout || "");
    const og =
      html.match(/property="og:description"\s+content="([^"]+)"/)?.[1] ||
      html.match(/content="([^"]+)"\s+property="og:description"/)?.[1] ||
      "";
    const title =
      html.match(/property="og:title"\s+content="([^"]+)"/)?.[1] || "";
    return stripHtml(`${title} ${og}`);
  } catch {
    return "";
  }
}

function relevantToStock(
  blob: string,
  code: string,
  name: string,
): boolean {
  const t = stripHtml(blob);
  if (t.includes(code)) return true;
  if (name && t.includes(name)) return true;
  const short = name.replace(/[()]/g, "").replace(/投控$/, "");
  if (short && short.length >= 2 && t.includes(short)) return true;
  return false;
}

function mergeTarget(
  byBroker: Map<string, BrokerTargetPrice>,
  row: BrokerTargetPrice,
) {
  const prev = byBroker.get(row.broker);
  if (!prev) {
    byBroker.set(row.broker, row);
    return;
  }
  const newer =
    row.asOf && prev.asOf
      ? row.asOf > prev.asOf
      : row.asOf && !prev.asOf
        ? true
        : false;
  const sameDayNewerOrDiff =
    row.asOf && prev.asOf && row.asOf === prev.asOf && row.target !== prev.target;
  if (newer || sameDayNewerOrDiff || (!prev.asOf && row.asOf)) {
    byBroker.set(row.broker, row);
  }
}

type GNewsItem = {
  title: string;
  link: string;
  pubDate: string;
  source: string;
};

async function googleNewsSearch(q: string): Promise<GNewsItem[]> {
  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const run = promisify(execFile);
    const url =
      "https://news.google.com/rss/search?" +
      `q=${encodeURIComponent(q)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
    const { stdout } = await run(
      "curl",
      [
        "-sS",
        "-L",
        "-A",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "--max-time",
        "18",
        url,
      ],
      { timeout: 22000, maxBuffer: 4 * 1024 * 1024 },
    );
    const xml = String(stdout || "");
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
      const block = m[1];
      return {
        title: decodeXml(block.match(/<title>([\s\S]*?)<\/title>/)?.[1] || ""),
        link: decodeXml(block.match(/<link>([\s\S]*?)<\/link>/)?.[1] || ""),
        pubDate: block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "",
        source: decodeXml(
          block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || "",
        ),
      };
    });
  } catch {
    return [];
  }
}

async function collectFromGoogleNews(
  code: string,
  name: string,
  byBroker: Map<string, BrokerTargetPrice>,
) {
  const queries = [
    `${name} 目標價 when:2y`,
    `${name} 目標價 外資 when:2y`,
    `${name}(${code}) 目標價 when:2y`,
  ];
  const seenTitles = new Set<string>();
  for (const q of queries) {
    const items = await googleNewsSearch(q);
    for (const item of items) {
      if (!item.title || seenTitles.has(item.title)) continue;
      seenTitles.add(item.title);
      if (!relevantToStock(item.title, code, name)) continue;
      if (!/目標[股]?價|[0-9]{2,5}\s*元/.test(item.title)) continue;
      const asOf = pubDateToYmd(item.pubDate);
      const found = extractBrokerTargetsFromText(item.title, {
        asOf,
        source: item.source
          ? `gnews:${item.source}`
          : "gnews",
        url: item.link || null,
      });
      for (const row of found) mergeTarget(byBroker, row);
    }
    if (byBroker.size >= 10) break;
  }
}

async function collectFromCnyes(
  code: string,
  name: string,
  byBroker: Map<string, BrokerTargetPrice>,
) {
  const queries = [
    `${name}目標價`,
    `${name}目標股價`,
    `${name} 目標價`,
    `${code}-TW 目標價`,
  ];
  const articlesToHint: { id: number; asOf: string | null }[] = [];

  for (const q of queries) {
    const items = await cnyesSearch(q, 15);
    for (const item of items) {
      const title = stripHtml(item.title ?? "");
      const content = stripHtml(item.content ?? "");
      const summary = stripHtml(item.summary ?? "");
      const blob = `${title}\n${content}\n${summary}`;
      if (!relevantToStock(blob, code, name)) continue;
      const asOf = toYmd(item.publishAt);
      const found = extractBrokerTargetsFromText(blob, {
        asOf,
        source: item.newsId ? `cnyes-news:${item.newsId}` : "cnyes-news",
        url: item.newsId
          ? `https://news.cnyes.com/news/id/${item.newsId}`
          : null,
      });
      for (const row of found) mergeTarget(byBroker, row);
      if (
        !found.length &&
        item.newsId &&
        (/目標[股]?價/.test(title) || findBroker(title)) &&
        articlesToHint.length < 6
      ) {
        articlesToHint.push({ id: item.newsId, asOf });
      }
    }
    if (byBroker.size >= 10) break;
  }

  for (const { id, asOf } of articlesToHint) {
    if (byBroker.size >= 12) break;
    const hint = await fetchArticleHint(id);
    if (!hint) continue;
    const found = extractBrokerTargetsFromText(hint, {
      asOf,
      source: `cnyes-news:${id}`,
      url: `https://news.cnyes.com/news/id/${id}`,
    });
    for (const row of found) mergeTarget(byBroker, row);
  }
}

async function collectFromYahooAdr(
  code: string,
  byBroker: Map<string, BrokerTargetPrice>,
) {
  const adr = ADR_BY_CODE[code];
  if (!adr) return;
  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const run = promisify(execFile);
    const jar = `/tmp/yahoo-broker-${process.pid}.txt`;
    await run(
      "curl",
      ["-sS", "-c", jar, "-b", jar, "-A", "Mozilla/5.0", "https://fc.yahoo.com", "-o", "/dev/null"],
      { timeout: 12000 },
    );
    const crumbRes = await run(
      "curl",
      [
        "-sS",
        "-b",
        jar,
        "-c",
        jar,
        "-A",
        "Mozilla/5.0",
        "https://query1.finance.yahoo.com/v1/test/getcrumb",
      ],
      { timeout: 12000 },
    );
    const crumb = String(crumbRes.stdout || "").trim();
    if (!crumb) return;

    const fetchQuote = async (symbol: string) => {
      const url =
        `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
        `?modules=upgradeDowngradeHistory,financialData&crumb=${encodeURIComponent(crumb)}`;
      const { stdout } = await run(
        "curl",
        [
          "-sS",
          "-b",
          jar,
          "-c",
          jar,
          "-A",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
          "--max-time",
          "18",
          url,
        ],
        { timeout: 22000, maxBuffer: 2 * 1024 * 1024 },
      );
      return JSON.parse(String(stdout || "{}")) as {
        quoteSummary?: {
          result?: Array<{
            financialData?: { currentPrice?: { raw?: number } };
            upgradeDowngradeHistory?: {
              history?: Array<{
                epochGradeDate?: number;
                firm?: string;
                currentPriceTarget?: number;
                priceTargetAction?: string;
              }>;
            };
          }>;
        };
      };
    };

    const [adrJson, twJson] = await Promise.all([
      fetchQuote(adr),
      fetchQuote(`${code}.TW`),
    ]);
    const adrPrice =
      adrJson.quoteSummary?.result?.[0]?.financialData?.currentPrice?.raw;
    const twPrice =
      twJson.quoteSummary?.result?.[0]?.financialData?.currentPrice?.raw;
    const hist =
      adrJson.quoteSummary?.result?.[0]?.upgradeDowngradeHistory?.history ??
      [];
    if (
      !adrPrice ||
      !twPrice ||
      adrPrice <= 0 ||
      twPrice <= 0 ||
      !hist.length
    ) {
      return;
    }
    const fxShares = twPrice / adrPrice; // ADR 報價 → 約當每股台幣

    for (const h of hist) {
      if (h.currentPriceTarget == null || !h.firm) continue;
      const broker = findBroker(h.firm);
      if (!broker) continue;
      const target = round0(h.currentPriceTarget * fxShares);
      if (target < 5 || target > 100000) continue;
      mergeTarget(byBroker, {
        broker: broker.display,
        target,
        asOf: toYmd(h.epochGradeDate ?? null),
        kind: broker.kind,
        source: `yahoo-adr:${adr}`,
        snippet: `${h.firm} ${h.currentPriceTarget} USD → ≈${target} TWD`,
        url: `https://finance.yahoo.com/quote/${adr}/analysis/`,
      });
    }
  } catch {
    // ADR 為加分項，失敗略過
  }
}

async function fetchLastPrice(code: string): Promise<number | null> {
  const symbol = encodeURIComponent(`TWS:${code}:STOCK`);
  const url =
    "https://marketinfo.api.cnyes.com/mi/api/v1/financialIndicator/targetPrice/" +
    symbol;
  try {
    const payload =
      (await fetchJsonViaCurl<{
        data?: { last?: number | null } | null;
      }>(url)) ??
      (await fetchJson<{
        data?: { last?: number | null } | null;
      }>(url));
    const last = payload?.data?.last;
    return typeof last === "number" && last > 0 ? last : null;
  } catch {
    return null;
  }
}

function isPlausibleTarget(target: number, last: number | null): boolean {
  if (!Number.isFinite(target) || target < 5) return false;
  if (last == null || !(last > 0)) {
    // 無現價時僅擋明顯不合理的極小值（多半是％或誤抓）
    return target >= 10;
  }
  // 允許低估到 3 折、高估到約 6 倍（成長股外資常給高目標）
  return target >= last * 0.3 && target <= last * 6;
}

/**
 * 取得個股內外資券商目標價列表（快取優先；可 force）。
 */
export async function getBrokerTargetPrices(
  code: string,
  options?: { name?: string | null; force?: boolean },
): Promise<BrokerTargetsPayload> {
  const stockCode = code.trim();
  const name = (options?.name ?? "").trim() || stockCode;
  const empty = (reason: string): BrokerTargetsPayload => ({
    code: stockCode,
    name,
    targets: [],
    builtAt: new Date().toISOString(),
    source: "multi",
    emptyReason: reason,
  });

  if (!/^\d{4}$/.test(stockCode)) {
    return empty("代號格式不符");
  }

  let cache =
    (await readCacheFile<TargetsCache>(CACHE)) ?? {
      builtAt: "",
      byCode: {},
    };
  const cached = cache.byCode[stockCode];
  if (!options?.force && cached?.builtAt) {
    const age = Date.now() - Date.parse(cached.builtAt);
    const ttl = cached.targets?.length ? TTL_HIT_MS : TTL_EMPTY_MS;
    if (Number.isFinite(age) && age >= 0 && age < ttl) {
      return cached;
    }
  }

  const byBroker = new Map<string, BrokerTargetPrice>();

  // Google News 覆蓋面最大；Cnyes／Yahoo ADR 並行補齊
  const [, , , lastPrice] = await Promise.all([
    collectFromGoogleNews(stockCode, name, byBroker),
    collectFromCnyes(stockCode, name, byBroker),
    collectFromYahooAdr(stockCode, byBroker),
    fetchLastPrice(stockCode),
  ]);

  const targets = [...byBroker.values()]
    .filter((t) => isPlausibleTarget(t.target, lastPrice))
    .sort(
      (a, b) =>
        b.target - a.target ||
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
      : "近兩年公開新聞未解析到具名券商目標價",
  };

  cache.byCode[stockCode] = payload;
  cache.builtAt = new Date().toISOString();
  await writeCacheFile(CACHE, cache).catch(() => null);
  return payload;
}
