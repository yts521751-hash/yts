/**
 * 內外資券商目標價＋預估 EPS（逐家，非 FactSet 共識彙總）。
 *
 * 來源（合併、依券商去重保留最新）：
 * 1) Google News RSS（多查詢／較長 lookback／代號＋股名＋券商 OR）
 * 2) Bing News RSS（標題＋摘要）
 * 3) 鉅亨新聞（Cnyes）搜尋＋文章 og:description
 * 4) Yahoo Finance ADR upgradeDowngradeHistory（少數有 ADR）
 *
 * Goodinfo 等表格式來源有 Cloudflare，伺服器端無法穩抓。
 * 快取：fundamentals-broker-targets.json；有資料 TTL 24h、空結果 2h。
 * 展開／查詢懶加載；日終可背景暖機價值選股＋成值前段。
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
  /** 目標價（元，台幣）；僅有 EPS 時可為 null */
  target: number | null;
  /** 預估 EPS（元）；報道有寫才有 */
  eps?: number | null;
  /** EPS 年別標籤：明年／今年／2026 等 */
  epsYear?: string | null;
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
const TTL_EMPTY_MS = 2 * 60 * 60 * 1000;
/** 過期但仍可立即回傳的寬限期（背景再刷） */
const STALE_SERVE_MS = 7 * 24 * 60 * 60 * 1000;
/** 單檔展開總預算，避免 UI 卡太久 */
const FETCH_BUDGET_MS = 9_000;

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

const BROKER_OR =
  "大摩 OR 小摩 OR 美銀 OR 高盛 OR 花旗 OR 瑞銀 OR 麥格理 OR 野村 OR 里昂 OR 大和 OR 元大 OR 凱基 OR 富邦 OR 國泰 OR 群益 OR 永豐 OR 中信 OR 匯豐 OR 巴克萊 OR 傑富瑞";

/** TW 代號 → Yahoo ADR（有逐家目標價時才有用） */
const ADR_BY_CODE: Record<string, string> = {
  "2330": "TSM",
};

/** 常見股名別名（擴大新聞命中） */
const NAME_ALIASES: Record<string, string[]> = {
  "2330": ["台積", "TSMC"],
  "2454": ["聯發科", "MTK"],
  "2317": ["鴻海", "Foxconn"],
  "2303": ["聯電", "UMC"],
  "2382": ["廣達"],
  "3711": ["日月光", "ASE"],
  "6669": ["緯穎"],
  "2344": ["華邦"],
  "2408": ["南亞科"],
  "3017": ["奇鋐"],
  "3037": ["欣興"],
  "8046": ["南電"],
  "6446": ["藥華"],
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
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const decodeXml = (s: string) =>
  stripHtml(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));

const round0 = (n: number) => Math.round(n);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** 解析「3,700」「2988」「7.5」等數字字串 */
function parsePriceToken(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").replace(/\s+/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 1 || n > 100000) return null;
  return n;
}

/** EPS 可為小數；擋明顯不合理 */
function parseEpsToken(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").replace(/\s+/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0 || n > 2000) return null;
  return round2(n);
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

function stockNameVariants(code: string, name: string): string[] {
  const out = new Set<string>();
  const n = name.trim();
  if (n) out.add(n);
  const short = n.replace(/[()]/g, "").replace(/投控$/, "").replace(/控股$/, "");
  if (short && short.length >= 2) out.add(short);
  for (const a of NAME_ALIASES[code] ?? []) out.add(a);
  return [...out];
}

/**
 * 從中文新聞句／標題抽出「券商 + 目標價／預估 EPS」。
 * 支援：目標價／目標股價、千分位逗號、喊／給／至／上看；EPS 上看／預估／估。
 * 「由 A 上調至 B」取 B；略過「目標價上調 370 元」這類調幅。
 */
export function extractBrokerTargetsFromText(
  text: string,
  options?: {
    asOf?: string | null;
    source?: string | null;
    url?: string | null;
    /** 若提供，優先把目標價配到含該股名的子句 */
    stockHints?: string[];
  },
): BrokerTargetPrice[] {
  const clean = stripHtml(text)
    // 統一千分位：3,700 → 3700（保留小數）
    .replace(/(\d),(\d{3})(?!\d)/g, "$1$2");
  const hasTarget = /目標[股]?價/.test(clean);
  const hasEps = /EPS|每股盈餘|每股盈餘/.test(clean) || /預估\s*EPS|EPS\s*預估|明年\s*EPS|今年\s*EPS/.test(clean);
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

  const setTarget = (
    broker: BrokerAlias,
    target: number,
    snippetFrom: number,
    snippetTo: number,
  ) => {
    if (!Number.isFinite(target) || target < 1 || target > 100000) return;
    if (target < 5) return;
    const row = ensure(broker, snippetFrom, snippetTo);
    if (row.target == null) row.target = round0(target);
  };

  const setEps = (
    broker: BrokerAlias,
    eps: number,
    epsYear: string | null,
    snippetFrom: number,
    snippetTo: number,
  ) => {
    if (!Number.isFinite(eps) || eps <= 0 || eps > 2000) return;
    const row = ensure(broker, snippetFrom, snippetTo);
    if (row.eps == null) {
      row.eps = round2(eps);
      row.epsYear = epsYear;
    } else if (!row.epsYear && epsYear) {
      row.epsYear = epsYear;
    }
  };

  const brokerNear = (index: number, span: number) => {
    const left = clean.slice(Math.max(0, index - 72), index);
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
    const right = clean.slice(index, Math.min(clean.length, index + span + 48));
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
    setTarget(broker, price, Math.max(0, m.index - 36), m.index + m[0].length);
  }

  // B) 目標價…(調升|上調|維持|上看)?…(至|到|為|看至|上看|飆|衝) N
  const reToPrice =
    /目標[股]?價[^0-9由]{0,28}?(?:上[調修升]|調[升降]|下[調修]|維[持持]|上看)?[^0-9]{0,12}?(?:至|到|為|看至|上看|飆(?:至|到|上)?|衝(?:至|到|上)?|升至)\s*([0-9]{2,5}(?:\.[0-9]+)?)\s*元?/g;
  while ((m = reToPrice.exec(clean))) {
    const price = parsePriceToken(m[1]);
    if (price == null) continue;
    const broker = brokerNear(m.index, m[0].length);
    if (!broker) continue;
    setTarget(broker, price, Math.max(0, m.index - 36), m.index + m[0].length);
  }

  // C) 「高盛喊 7000」「美銀給…750」「里昂喊升…至 3700」
  const reBrokerVerb =
    /(摩根士丹利|台灣摩根士丹利|大摩|摩根大通|小摩|美銀|美國銀行|高盛|花旗|瑞銀|麥格理|野村|匯豐|巴克萊|傑富瑞|大和|法巴|德銀|星展|美林|里昂證券|里昂|元大|凱基|國泰證|國泰證券|富邦|群益|永豐|中信|兆豐|統一證|台新|第一金|宏遠|本土投顧|本土券商|BofA|Goldman|UBS|Nomura|Citi|Bernstein|Needham|Stifel|Barclays|JPMorgan)[^0-9]{0,48}?(?:喊(?:到|上|出)?|給|上看|升至|調升至|調降至|上調至|下修至|目標[股]?價[^0-9由]{0,20}?(?:至|到|為|看|喊|飆|衝)?)[^0-9]{0,8}?([0-9]{2,5}(?:\.[0-9]+)?)\s*元?/g;
  while ((m = reBrokerVerb.exec(clean))) {
    const broker = findBroker(m[1]);
    const price = parsePriceToken(m[2]);
    if (!broker || price == null) continue;
    setTarget(broker, price, m.index, m.index + m[0].length);
  }

  // D) 「目標價上看／喊／飆 N」
  const reLook =
    /目標[股]?價\s*(?:上看|喊(?:到|上|出)?|飆(?:至|到|上)?|衝(?:至|到|上)?)\s*(?:至|到)?\s*([0-9]{2,5}(?:\.[0-9]+)?)\s*元?/g;
  while ((m = reLook.exec(clean))) {
    const price = parsePriceToken(m[1]);
    if (price == null) continue;
    const broker = brokerNear(m.index, m[0].length);
    if (!broker) continue;
    setTarget(broker, price, Math.max(0, m.index - 36), m.index + m[0].length);
  }

  // D2) 「嗨喊2310元目標價」「喊出 3500 元目標價」
  const reVerbThenTarget =
    /(摩根士丹利|大摩|小摩|美銀|高盛|花旗|瑞銀|麥格理|野村|匯豐|巴克萊|傑富瑞|大和|法巴|德銀|星展|里昂|元大|凱基|富邦|群益|永豐|中信|兆豐|台新|第一金|宏遠)[^0-9]{0,24}?(?:嗨?喊|給出?|上看)\s*([0-9]{2,5}(?:\.[0-9]+)?)\s*元?\s*目標[股]?價/g;
  while ((m = reVerbThenTarget.exec(clean))) {
    const broker = findBroker(m[1]);
    const price = parsePriceToken(m[2]);
    if (!broker || price == null) continue;
    setTarget(broker, price, m.index, m.index + m[0].length);
  }

  // E) 全文僅一家券商＋任一絕對目標價
  if (![...byDisplay.values()].some((r) => r.target != null)) {
    const brokers = findAllBrokers(clean);
    const fromTo = clean.match(
      /目標[股]?價[^。]{0,48}?由\s*[0-9.]+[^0-9]{0,20}?(?:上[調修升]|調[升降]|至|到|提升至)\s*([0-9]{2,5}(?:\.[0-9]+)?)/,
    );
    const pm = clean.match(
      /目標[股]?價[^0-9由]{0,24}(?:至|到|為|看至|上看|喊(?:到|上|出)?|飆|衝)?\s*([0-9]{2,5}(?:\.[0-9]+)?)/,
    );
    const raw = fromTo?.[1] ?? pm?.[1];
    if (brokers.length === 1 && raw) {
      const delta =
        /目標[股]?價[^0-9]{0,8}(?:上[調修升]|調[升降]|下[調修]|砍)[^0-9至到看喊給為飆衝]{0,6}[0-9]/.test(
          clean,
        ) && !/(?:至|到|為|看|喊|給|飆|衝)/.test(clean);
      if (!delta) {
        const price = parsePriceToken(raw);
        if (price != null) {
          setTarget(brokers[0], price, 0, Math.min(100, clean.length));
        }
      }
    }
  }

  // F) EPS 句型：明年／今年／YYYY EPS … 至／上看／估 N
  const inferEpsYear = (slice: string): string | null => {
    const y = slice.match(/(20[2-3][0-9])\s*年?/);
    if (y) return y[1];
    if (/明年|下一?年|前瞻/.test(slice)) return "明年";
    if (/今年|本年度|當年/.test(slice)) return "今年";
    if (/全年/.test(slice)) return "全年";
    return null;
  };

  const reEps =
    /((?:明年|今年|全年|前瞻|下一?年|20[2-3][0-9]\s*年?)[^。；;\n]{0,12})?(?:每股盈[餘余]|EPS)\s*(?:預估|估測|估計|預期)?[^0-9]{0,18}?(?:上[調修升]|調[升降]|下[調修]|上看|喊|估|寫|衝|至|到|為)?\s*(?:至|到|為|看)?\s*([0-9]{1,4}(?:\.[0-9]+)?)\s*元?/gi;
  while ((m = reEps.exec(clean))) {
    const eps = parseEpsToken(m[2]);
    if (eps == null) continue;
    // 略過「目標價…59%至」誤抓：要求前後不是「目標價…％」
    const around = clean.slice(Math.max(0, m.index - 12), m.index + m[0].length);
    if (/目標[股]?價/.test(around) && /%|％/.test(around) && eps > 50) {
      // 多半是調幅百分比，不是 EPS
      continue;
    }
    const yearSlice = (m[1] || "") + clean.slice(Math.max(0, m.index - 16), m.index);
    const epsYear = inferEpsYear(yearSlice);
    const broker = brokerNear(m.index, m[0].length);
    if (!broker) continue;
    // EPS 若大於 800 且同時像目標價，略過（誤抓）
    if (eps >= 800 && hasTarget) continue;
    setEps(broker, eps, epsYear, Math.max(0, m.index - 24), m.index + m[0].length);
  }

  // F2) 「EPS預估上修至96.5元」「預估EPS至 160」
  const reEpsAlt =
    /(?:預估\s*)?EPS\s*(?:預估|估測)?[^0-9]{0,20}?(?:上[調修升]|調[升降]|下[調修]|至|到|為|上看)\s*([0-9]{1,4}(?:\.[0-9]+)?)\s*元?/gi;
  while ((m = reEpsAlt.exec(clean))) {
    const eps = parseEpsToken(m[1]);
    if (eps == null || eps >= 800) continue;
    const broker = brokerNear(m.index, m[0].length);
    if (!broker) continue;
    const yearSlice = clean.slice(Math.max(0, m.index - 20), m.index);
    setEps(
      broker,
      eps,
      inferEpsYear(yearSlice),
      Math.max(0, m.index - 24),
      m.index + m[0].length,
    );
  }

  // 若有股名提示且多券商句，不額外過濾（已靠 brokerNear）
  void options?.stockHints;

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
        "10",
        `https://news.cnyes.com/news/id/${newsId}`,
      ],
      { timeout: 12000, maxBuffer: 3 * 1024 * 1024 },
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
  for (const v of stockNameVariants(code, name)) {
    if (v && t.includes(v)) return true;
  }
  return false;
}

/** 排除 FactSet 速報／美股雜訊 */
function isNoiseHeadline(title: string): boolean {
  const t = stripHtml(title);
  if (/Factset|FactSet|鉅亨速報/.test(t) && /預估目標價為/.test(t)) return true;
  if (/-[A-Z]{2}\)|-US\)|\([A-Z]{1,5}-US\)/.test(t)) return true;
  if (/TradingView|預測\s*—\s*20\d{2}的目標價/.test(t)) return true;
  return false;
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
    // 補缺：較舊或同日可填入缺失欄位
    if (merged.target == null && row.target != null) merged.target = row.target;
    else if (
      row.target != null &&
      merged.target != null &&
      row.target !== merged.target &&
      newer
    ) {
      merged.target = row.target;
    }
    if (merged.eps == null && row.eps != null) {
      merged.eps = row.eps;
      merged.epsYear = row.epsYear ?? null;
    } else if (!merged.epsYear && row.epsYear) {
      merged.epsYear = row.epsYear;
    }
    if (!merged.url && row.url) merged.url = row.url;
    if (!merged.snippet && row.snippet) merged.snippet = row.snippet;
    if (!merged.source && row.source) merged.source = row.source;
    if (!merged.asOf && row.asOf) merged.asOf = row.asOf;
  } else {
    // 較舊：只補缺
    if (merged.target == null && row.target != null) merged.target = row.target;
    if (merged.eps == null && row.eps != null) {
      merged.eps = row.eps;
      merged.epsYear = row.epsYear ?? null;
    }
  }

  byBroker.set(row.broker, merged);
}

type NewsItem = {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  description?: string;
};

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

function parseRssItems(xml: string): NewsItem[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const block = m[1];
    const descRaw =
      block.match(/<description>([\s\S]*?)<\/description>/)?.[1] || "";
    return {
      title: decodeXml(block.match(/<title>([\s\S]*?)<\/title>/)?.[1] || ""),
      link: decodeXml(block.match(/<link>([\s\S]*?)<\/link>/)?.[1] || ""),
      pubDate: block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "",
      source: decodeXml(
        block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ||
          block.match(/<News:Source>([\s\S]*?)<\/News:Source>/)?.[1] ||
          "",
      ),
      description: decodeXml(descRaw),
    };
  });
}

async function googleNewsSearch(q: string): Promise<NewsItem[]> {
  const url =
    "https://news.google.com/rss/search?" +
    `q=${encodeURIComponent(q)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
  const xml = await curlGet(url, 16);
  return parseRssItems(xml);
}

async function bingNewsSearch(q: string): Promise<NewsItem[]> {
  const url =
    "https://www.bing.com/news/search?" +
    `q=${encodeURIComponent(q)}&format=rss&mkt=zh-TW`;
  const xml = await curlGet(url, 14);
  return parseRssItems(xml);
}

function ingestNewsItems(
  items: NewsItem[],
  code: string,
  name: string,
  byBroker: Map<string, BrokerTargetPrice>,
  sourcePrefix: string,
  seenTitles: Set<string>,
) {
  const hints = stockNameVariants(code, name);
  for (const item of items) {
    if (!item.title || seenTitles.has(item.title)) continue;
    seenTitles.add(item.title);
    if (isNoiseHeadline(item.title)) continue;
    const blob = `${item.title}\n${item.description || ""}`;
    if (!relevantToStock(blob, code, name)) continue;
    if (
      !/目標[股]?價|EPS|每股盈[餘余]|[0-9]{2,5}\s*元/.test(blob) &&
      !findBroker(blob)
    ) {
      continue;
    }
    const asOf = pubDateToYmd(item.pubDate);
    const found = extractBrokerTargetsFromText(blob, {
      asOf,
      source: item.source
        ? `${sourcePrefix}:${item.source}`
        : sourcePrefix,
      url: item.link || null,
      stockHints: hints,
    });
    for (const row of found) mergeTarget(byBroker, row);
  }
}

async function collectFromGoogleNews(
  code: string,
  name: string,
): Promise<BrokerTargetPrice[]> {
  const byBroker = new Map<string, BrokerTargetPrice>();
  const nameMain = stockNameVariants(code, name)[0] || name;
  const queries = [
    `${nameMain} 目標價 when:5y`,
    `${nameMain}(${code}) 目標價 when:5y`,
    `${code} 目標價 when:5y`,
    `${nameMain} 目標價 ${BROKER_OR} when:5y`,
    `${nameMain} 外資 目標價 when:5y`,
    `${nameMain} 目標價一覽 OR 外資點評 when:5y`,
    `${nameMain} EPS 目標價 when:5y`,
  ];
  const seenTitles = new Set<string>();
  const batches = await Promise.all(
    queries.map((q) => googleNewsSearch(q).catch(() => [] as NewsItem[])),
  );
  for (const items of batches) {
    ingestNewsItems(items, code, name, byBroker, "gnews", seenTitles);
  }
  return [...byBroker.values()];
}

async function collectFromBingNews(
  code: string,
  name: string,
): Promise<BrokerTargetPrice[]> {
  const byBroker = new Map<string, BrokerTargetPrice>();
  const nameMain = stockNameVariants(code, name)[0] || name;
  const queries = [
    `${nameMain} 目標價`,
    `${code} 目標價`,
    `${nameMain} 目標價 外資`,
    `${nameMain} 大摩 OR 美銀 OR 高盛 OR 凱基 目標價`,
  ];
  const seenTitles = new Set<string>();
  const batches = await Promise.all(
    queries.map((q) => bingNewsSearch(q).catch(() => [] as NewsItem[])),
  );
  for (const items of batches) {
    ingestNewsItems(items, code, name, byBroker, "bing", seenTitles);
  }
  return [...byBroker.values()];
}

async function collectFromCnyes(
  code: string,
  name: string,
): Promise<BrokerTargetPrice[]> {
  const byBroker = new Map<string, BrokerTargetPrice>();
  const nameMain = stockNameVariants(code, name)[0] || name;
  const queries = [
    `${nameMain}目標價`,
    `${nameMain} 目標價`,
    `${nameMain}(${code}) 目標價`,
    `${nameMain} 外資 目標價`,
    `${nameMain} 目標價 大摩`,
    `${nameMain} 目標價 美銀`,
    `${nameMain} EPS 目標價`,
  ];
  const articlesToHint: { id: number; asOf: string | null }[] = [];
  const seenIds = new Set<number>();
  const hints = stockNameVariants(code, name);

  const batches = await Promise.all(
    queries.map((q) => cnyesSearch(q, 12).catch(() => [] as CnyesSearchItem[])),
  );

  for (const items of batches) {
    for (const item of items) {
      const title = stripHtml(item.title ?? "");
      if (isNoiseHeadline(title)) continue;
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
        stockHints: hints,
      });
      for (const row of found) mergeTarget(byBroker, row);
      if (
        !found.length &&
        item.newsId &&
        !seenIds.has(item.newsId) &&
        (/目標[股]?價/.test(title) || findBroker(title)) &&
        articlesToHint.length < 5
      ) {
        seenIds.add(item.newsId);
        articlesToHint.push({ id: item.newsId, asOf });
      }
    }
  }

  const hintResults = await Promise.all(
    articlesToHint.map(async ({ id, asOf }) => {
      const hint = await fetchArticleHint(id);
      return { id, asOf, hint };
    }),
  );
  for (const { id, asOf, hint } of hintResults) {
    if (!hint) continue;
    const found = extractBrokerTargetsFromText(hint, {
      asOf,
      source: `cnyes-news:${id}`,
      url: `https://news.cnyes.com/news/id/${id}`,
      stockHints: hints,
    });
    for (const row of found) mergeTarget(byBroker, row);
  }
  return [...byBroker.values()];
}

async function collectFromYahooAdr(
  code: string,
): Promise<BrokerTargetPrice[]> {
  const byBroker = new Map<string, BrokerTargetPrice>();
  const adr = ADR_BY_CODE[code];
  if (!adr) return [];
  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const run = promisify(execFile);
    const jar = `/tmp/yahoo-broker-${process.pid}.txt`;
    await run(
      "curl",
      ["-sS", "-c", jar, "-b", jar, "-A", "Mozilla/5.0", "https://fc.yahoo.com", "-o", "/dev/null"],
      { timeout: 10000 },
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
      { timeout: 10000 },
    );
    const crumb = String(crumbRes.stdout || "").trim();
    if (!crumb) return [];

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
          "14",
          url,
        ],
        { timeout: 18000, maxBuffer: 2 * 1024 * 1024 },
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
      return [];
    }
    const fxShares = twPrice / adrPrice;

    for (const h of hist) {
      if (h.currentPriceTarget == null || !h.firm) continue;
      const broker = findBroker(h.firm);
      if (!broker) continue;
      const target = round0(h.currentPriceTarget * fxShares);
      if (target < 5 || target > 100000) continue;
      mergeTarget(byBroker, {
        broker: broker.display,
        target,
        eps: null,
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
  return [...byBroker.values()];
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
    return target >= 10;
  }
  return target >= last * 0.3 && target <= last * 6;
}

function isPlausibleEps(eps: number, last: number | null): boolean {
  if (!Number.isFinite(eps) || eps <= 0 || eps > 2000) return false;
  // 極高價股 EPS 可到數百；對低價股 EPS > 現價多半誤抓
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

function brokerTargetsFlightBag() {
  const g = globalThis as typeof globalThis & {
    __jinliuBrokerTargetsFlight?: Map<string, Promise<BrokerTargetsPayload>>;
    __jinliuBrokerTargetsMemo?: Map<
      string,
      { at: number; value: BrokerTargetsPayload }
    >;
  };
  if (!g.__jinliuBrokerTargetsFlight) {
    g.__jinliuBrokerTargetsFlight = new Map();
  }
  if (!g.__jinliuBrokerTargetsMemo) {
    g.__jinliuBrokerTargetsMemo = new Map();
  }
  return {
    flight: g.__jinliuBrokerTargetsFlight,
    memo: g.__jinliuBrokerTargetsMemo,
  };
}

async function scrapeBrokerTargetPrices(
  stockCode: string,
  name: string,
): Promise<BrokerTargetsPayload> {
  let cache =
    (await readCacheFile<TargetsCache>(CACHE)) ?? {
      builtAt: "",
      byCode: {},
    };

  const byBroker = new Map<string, BrokerTargetPrice>();

  const [gnewsRows, bingRows, cnyesRows, yahooRows, lastPrice] =
    await Promise.all([
      withBudget(
        collectFromGoogleNews(stockCode, name).catch(
          () => [] as BrokerTargetPrice[],
        ),
        FETCH_BUDGET_MS,
      ),
      withBudget(
        collectFromBingNews(stockCode, name).catch(
          () => [] as BrokerTargetPrice[],
        ),
        FETCH_BUDGET_MS,
      ),
      withBudget(
        collectFromCnyes(stockCode, name).catch(
          () => [] as BrokerTargetPrice[],
        ),
        FETCH_BUDGET_MS,
      ),
      withBudget(
        collectFromYahooAdr(stockCode).catch(() => [] as BrokerTargetPrice[]),
        FETCH_BUDGET_MS,
      ),
      withBudget(fetchLastPrice(stockCode), Math.min(6000, FETCH_BUDGET_MS)),
    ]);

  for (const batch of [gnewsRows, bingRows, cnyesRows, yahooRows]) {
    if (!batch) continue;
    for (const row of batch) mergeTarget(byBroker, row);
  }

  const targets = [...byBroker.values()]
    .map((t) => {
      const next = { ...t };
      if (
        next.target != null &&
        !isPlausibleTarget(next.target, lastPrice)
      ) {
        next.target = null;
      }
      if (next.eps != null && !isPlausibleEps(next.eps, lastPrice)) {
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
      : "近數年公開新聞未解析到具名券商目標價或預估 EPS",
  };

  cache.byCode[stockCode] = payload;
  cache.builtAt = new Date().toISOString();
  await writeCacheFile(CACHE, cache).catch(() => null);
  const { memo } = brokerTargetsFlightBag();
  memo.set(stockCode, { at: Date.now(), value: payload });
  return payload;
}

/**
 * 取得個股內外資券商目標價／預估 EPS 列表（快取優先；可 force）。
 * 日終暖機寫入的快取會直接命中；過期快取先回傳再背景刷新，避免查詢卡在多來源刮取。
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

  const { flight, memo } = brokerTargetsFlightBag();

  if (!options?.force) {
    const mem = memo.get(stockCode);
    if (mem && Date.now() - mem.at < TTL_HIT_MS) {
      const age = Date.now() - Date.parse(mem.value.builtAt || "");
      const ttl = mem.value.targets?.length ? TTL_HIT_MS : TTL_EMPTY_MS;
      if (Number.isFinite(age) && age >= 0 && age < ttl) {
        return mem.value;
      }
    }
  }

  const cache =
    (await readCacheFile<TargetsCache>(CACHE)) ?? {
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
    // 過期但仍在寬限內：立刻回傳日終／前次暖機結果，背景刷新
    if (
      Number.isFinite(age) &&
      age >= 0 &&
      age < STALE_SERVE_MS &&
      (cached.targets?.length || age < TTL_EMPTY_MS * 6)
    ) {
      memo.set(stockCode, { at: Date.now(), value: cached });
      if (!flight.has(stockCode)) {
        const p = scrapeBrokerTargetPrices(
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

  const p = scrapeBrokerTargetPrices(stockCode, name).finally(() =>
    flight.delete(stockCode),
  );
  flight.set(stockCode, p);
  return p;
}

function warmBag() {
  const g = globalThis as typeof globalThis & {
    __jinliuBrokerTargetsWarm?: {
      running: boolean;
      promise: Promise<void> | null;
    };
  };
  if (!g.__jinliuBrokerTargetsWarm) {
    g.__jinliuBrokerTargetsWarm = { running: false, promise: null };
  }
  return g.__jinliuBrokerTargetsWarm;
}

/**
 * 背景暖機：價值選股宇宙＋成值前段，展開時可直接命中快取。
 * 不阻塞呼叫端；併發有限。
 */
export function requestBrokerTargetsWarm(
  stocks: Array<{ code: string; name?: string | null }>,
  reason = "warm",
  options?: { concurrency?: number; force?: boolean },
): boolean {
  const bag = warmBag();
  if (bag.running) return false;
  const list = stocks
    .map((s) => ({
      code: String(s.code || "").trim(),
      name: (s.name ?? "").trim() || null,
    }))
    .filter((s) => /^\d{4}$/.test(s.code));
  if (!list.length) return false;

  const concurrency = Math.max(1, Math.min(options?.concurrency ?? 2, 4));
  bag.running = true;
  bag.promise = (async () => {
    console.log(
      `[broker-targets] warm start (${reason}): n=${list.length} concurrency=${concurrency}`,
    );
    let i = 0;
    let ok = 0;
    let hits = 0;
    const workers = Array.from({ length: concurrency }, async () => {
      while (i < list.length) {
        const idx = i++;
        const s = list[idx];
        try {
          const r = await getBrokerTargetPrices(s.code, {
            name: s.name,
            force: Boolean(options?.force),
          });
          ok += 1;
          if (r.targets.length) hits += 1;
        } catch (err) {
          console.warn(`[broker-targets] warm ${s.code} failed`, err);
        }
      }
    });
    await Promise.all(workers);
    console.log(
      `[broker-targets] warm done (${reason}): ok=${ok}/${list.length} withData=${hits}`,
    );
  })()
    .catch((err) => {
      console.error(`[broker-targets] warm failed (${reason})`, err);
    })
    .finally(() => {
      bag.running = false;
      bag.promise = null;
    });
  return true;
}

/** 從價值選股＋成值快取組暖機名單 */
export async function warmBrokerTargetsFromUniverse(
  reason = "universe",
): Promise<boolean> {
  try {
    const stocks: Array<{ code: string; name?: string | null }> = [];
    const seen = new Set<string>();
    try {
      const { readValuePicksCache } = await import("@/lib/value-picks");
      const vp = await readValuePicksCache();
      for (const r of vp?.rows ?? []) {
        if (seen.has(r.code)) continue;
        seen.add(r.code);
        stocks.push({ code: r.code, name: r.name });
      }
    } catch {
      /* optional */
    }
    try {
      const turnover = await readCacheFile<{
        rows?: Array<{ code?: string; name?: string }>;
      }>("turnover-ranking-latest.json");
      for (const r of (turnover?.rows ?? []).slice(0, 40)) {
        const code = String(r.code || "").trim();
        if (!/^\d{4}$/.test(code) || seen.has(code)) continue;
        seen.add(code);
        stocks.push({ code, name: r.name ?? null });
      }
    } catch {
      /* optional */
    }
    if (!stocks.length) return false;
    return requestBrokerTargetsWarm(stocks, reason, { concurrency: 2 });
  } catch (err) {
    console.warn("[broker-targets] universe warm skipped", err);
    return false;
  }
}
