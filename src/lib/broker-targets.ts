/**
 * 內外資券商目標價（逐家，非 FactSet 共識）。
 *
 * 來源：鉅亨新聞（Cnyes）標題／摘要／內文，常見句型如
 * 「摩根士丹利將台積電目標價調升至 2988 元」。
 * Goodinfo 等表格式來源有 Cloudflare，伺服器端無法穩抓，故走新聞解析。
 *
 * 快取：fundamentals-broker-targets.json，TTL 12h；
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
  /** 目標價（元） */
  target: number;
  /** 報道／估計日 YYYY-MM-DD */
  asOf?: string | null;
  /** domestic | foreign | unknown */
  kind?: "domestic" | "foreign" | "unknown";
  /** 來源標籤 */
  source?: string | null;
  /** 原文片段（除錯／溯源） */
  snippet?: string | null;
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
const TTL_MS = 12 * 60 * 60 * 1000;

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
    aliases: ["摩根大通", "小摩", "JPMorgan", "J.P. Morgan", "JP摩根"],
  },
  {
    display: "美銀",
    kind: "foreign",
    aliases: ["美銀", "美國銀行", "美銀證", "BofA", "Bank of America"],
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
];

const stripHtml = (s: string) =>
  s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

const round0 = (n: number) => Math.round(n);

function toYmd(epochSec: number | null | undefined): string | null {
  if (epochSec == null || !Number.isFinite(epochSec)) return null;
  const d = new Date(epochSec * 1000);
  if (!Number.isFinite(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  // Cnyes publishAt 近似台北日：用 Asia/Taipei
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return `${y}-${m}-${day}`;
  }
}

function findBroker(text: string): BrokerAlias | null {
  // 長別名優先，避免「摩根」誤配
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

/**
 * 從中文新聞句抽出「券商 + 目標價」。
 * 支援：調升至／上調至／上修至／維持／看至／為／上看 等。
 * 優先取「上調／調升至 N」，略過「由 N 元」的舊價。
 */
export function extractBrokerTargetsFromText(
  text: string,
  options?: { asOf?: string | null; source?: string | null },
): BrokerTargetPrice[] {
  const clean = stripHtml(text);
  if (!clean.includes("目標價")) return [];

  const out: BrokerTargetPrice[] = [];
  const seen = new Set<string>();

  const push = (
    broker: BrokerAlias,
    target: number,
    index: number,
    snippetFrom: number,
  ) => {
    if (!Number.isFinite(target) || target < 1 || target > 20000) return;
    if (seen.has(broker.display)) return;
    seen.add(broker.display);
    out.push({
      broker: broker.display,
      target: round0(target),
      asOf: options?.asOf ?? null,
      kind: broker.kind,
      source: options?.source ?? "cnyes-news",
      snippet: clean.slice(Math.max(0, snippetFrom), index + 40),
    });
  };

  // 優先：目標價…(上調|調升|上修|調降|維持|上看)…至/到/為? N 元
  const rePrefer =
    /目標價[^。；;\n]{0,40}?(?:上[調修升]|調[升降]|維[持持]|上看)[^0-9]{0,12}?([0-9]{3,5}(?:\.[0-9]+)?)\s*元?/g;
  let m: RegExpExecArray | null;
  while ((m = rePrefer.exec(clean))) {
    const ctxStart = Math.max(0, m.index - 36);
    const broker =
      findBroker(clean.slice(ctxStart, m.index + m[0].length)) ||
      findBroker(clean.slice(ctxStart, m.index));
    if (!broker) continue;
    push(broker, Number(m[1]), m.index, ctxStart);
  }

  // 次選：目標價至／為／看至 N（且前文有券商）
  const reAlt =
    /目標價\s*(?:至|到|為|看至|上看)\s*([0-9]{3,5}(?:\.[0-9]+)?)\s*元?/g;
  while ((m = reAlt.exec(clean))) {
    const ctxStart = Math.max(0, m.index - 36);
    const broker = findBroker(clean.slice(ctxStart, m.index + m[0].length));
    if (!broker) continue;
    push(broker, Number(m[1]), m.index, ctxStart);
  }

  // 再退：全文僅一家券商＋任一「目標價…N」
  if (!out.length) {
    const broker = findBroker(clean);
    const pm = clean.match(
      /目標價[^0-9由]{0,20}([0-9]{3,5}(?:\.[0-9]+)?)/,
    );
    // 若句中有「由A…至B」取 B
    const fromTo = clean.match(
      /目標價[^。]{0,30}?由\s*[0-9.]+[^0-9]{0,12}?(?:上[調修升]|調[升降]|至|到)\s*([0-9]{3,5}(?:\.[0-9]+)?)/,
    );
    const raw = fromTo?.[1] ?? pm?.[1];
    if (broker && raw) {
      push(broker, Number(raw), 0, 0);
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

/** 抓單則新聞 meta description（常含「將目標價調升至 N 元」） */
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
      html.match(
        /property="og:description"\s+content="([^"]+)"/,
      )?.[1] ||
      html.match(
        /content="([^"]+)"\s+property="og:description"/,
      )?.[1] ||
      "";
    const title =
      html.match(/property="og:title"\s+content="([^"]+)"/)?.[1] || "";
    return stripHtml(`${title} ${og}`);
  } catch {
    return "";
  }
}

function relevantToStock(
  item: CnyesSearchItem,
  code: string,
  name: string,
): boolean {
  const blob = stripHtml(
    `${item.title ?? ""} ${item.content ?? ""} ${(item.keyword ?? []).join(" ")}`,
  );
  if (blob.includes(code)) return true;
  if (name && blob.includes(name)) return true;
  // 標題已標過 mark 的「{name}目標價」搜尋結果
  if (name && (item.title ?? "").includes(name.replace(/[()]/g, ""))) {
    return true;
  }
  return false;
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
    source: "cnyes-news",
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
    if (Number.isFinite(age) && age >= 0 && age < TTL_MS) {
      return cached;
    }
  }

  const queries = [
    `${name}目標價`,
    `${name} 目標價`,
    `${stockCode}-TW 目標價`,
  ];

  const byBroker = new Map<string, BrokerTargetPrice>();
  const articlesToHint: number[] = [];

  for (const q of queries) {
    const items = await cnyesSearch(q, 15);
    for (const item of items) {
      if (!relevantToStock(item, stockCode, name)) continue;
      const asOf = toYmd(item.publishAt);
      const text = `${item.title ?? ""}\n${item.content ?? ""}\n${item.summary ?? ""}`;
      const found = extractBrokerTargetsFromText(text, {
        asOf,
        source: item.newsId ? `cnyes-news:${item.newsId}` : "cnyes-news",
      });
      for (const row of found) {
        const prev = byBroker.get(row.broker);
        // 較新日期覆寫；同日較高目標價保留（資訊量）
        if (
          !prev ||
          (row.asOf && prev.asOf && row.asOf > prev.asOf) ||
          (row.asOf === prev.asOf && row.target !== prev.target)
        ) {
          if (!prev || (row.asOf && (!prev.asOf || row.asOf >= prev.asOf))) {
            byBroker.set(row.broker, row);
          }
        }
      }
      // 搜尋摘要常缺數字：排程抓 og:description
      if (
        !found.length &&
        item.newsId &&
        findBroker(stripHtml(item.title ?? "")) &&
        articlesToHint.length < 4
      ) {
        articlesToHint.push(item.newsId);
      }
    }
    // 已有足夠券商就停，避免打爆新聞 API
    if (byBroker.size >= 6) break;
  }

  // 補抓少數文章 meta（有券商名但缺數字）
  for (const nid of articlesToHint) {
    if (byBroker.size >= 8) break;
    const hint = await fetchArticleHint(nid);
    if (!hint) continue;
    const found = extractBrokerTargetsFromText(hint, {
      source: `cnyes-news:${nid}`,
    });
    for (const row of found) {
      if (!byBroker.has(row.broker)) byBroker.set(row.broker, row);
    }
  }

  const targets = [...byBroker.values()].sort(
    (a, b) =>
      b.target - a.target ||
      (b.asOf ?? "").localeCompare(a.asOf ?? "") ||
      a.broker.localeCompare(b.broker, "zh-Hant"),
  );

  const payload: BrokerTargetsPayload = {
    code: stockCode,
    name,
    targets,
    builtAt: new Date().toISOString(),
    source: "cnyes-news",
    emptyReason: targets.length
      ? null
      : "近期新聞未解析到逐家券商目標價",
  };

  cache.byCode[stockCode] = payload;
  cache.builtAt = new Date().toISOString();
  await writeCacheFile(CACHE, cache).catch(() => null);
  return payload;
}
