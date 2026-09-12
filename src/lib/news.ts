import {
  readCacheFile,
  writeCacheFile,
} from "@/lib/tw-market";

export type NewsItem = {
  id: string;
  title: string;
  link: string;
  source: string;
  publishedAt: string | null;
  summary: string;
};

export type NewsPayload = {
  items: NewsItem[];
  builtAt: string;
  source: "google-news-rss" | "cache" | "demo";
  deploySlot?: "active" | "staging";
};

export const NEWS_ACTIVE_CACHE = "news-active.json";
export const NEWS_STAGING_CACHE = "news-staging.json";
export const NEWS_META_CACHE = "news-deploy-meta.json";

type NewsMeta = {
  syncing: boolean;
  lastPromoteAt: string | null;
  lastBuildAt: string | null;
  lastError: string | null;
};

const FEEDS = [
  {
    source: "Google 新聞·台股",
    url: "https://news.google.com/rss/search?q=%E5%8F%B0%E8%82%A1&hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
  },
  {
    source: "Google 新聞·半導體",
    url: "https://news.google.com/rss/search?q=%E5%8F%B0%E8%82%A1%20%E5%8D%8A%E5%B0%8E%E9%AB%94&hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
  },
  {
    source: "Google 新聞·AI伺服器",
    url: "https://news.google.com/rss/search?q=%E5%8F%B0%E8%82%A1%20AI%20%E4%BC%BA%E6%9C%8D%E5%99%A8&hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
  },
];

function decodeXml(s: string) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function stripTags(s: string) {
  return decodeXml(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function pickTag(block: string, tag: string) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  return m ? decodeXml(m[1]) : "";
}

function parseRss(xml: string, source: string): NewsItem[] {
  const items: NewsItem[] = [];
  const chunks = xml.split(/<item>/i).slice(1);
  for (const chunk of chunks) {
    const block = chunk.split(/<\/item>/i)[0] ?? chunk;
    const title = stripTags(pickTag(block, "title"));
    const link = stripTags(pickTag(block, "link"));
    const pub = stripTags(pickTag(block, "pubDate"));
    const desc = stripTags(pickTag(block, "description")).slice(0, 180);
    if (!title || !link) continue;
    const publishedAt = pub ? new Date(pub).toISOString() : null;
    items.push({
      id: Buffer.from(`${source}|${link}`).toString("base64url").slice(0, 24),
      title,
      link,
      source,
      publishedAt: publishedAt && !Number.isNaN(Date.parse(publishedAt)) ? publishedAt : null,
      summary: desc,
    });
  }
  return items;
}

async function fetchFeed(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "JinChao/1.0 (news-radar; research)",
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function demoNews(): NewsPayload {
  return {
    items: [
      {
        id: "demo-1",
        title: "示範：台股題材熱度觀測（尚未抓到即時新聞）",
        link: "https://news.google.com/search?q=%E5%8F%B0%E8%82%A1&hl=zh-TW",
        source: "示範",
        publishedAt: new Date().toISOString(),
        summary: "新聞灰度同步稍後會寫入 active；目前顯示後備說明。",
      },
    ],
    builtAt: new Date().toISOString(),
    source: "demo",
    deploySlot: "active",
  };
}

type NewsBag = typeof globalThis & {
  __jinchaoNews?: { running: boolean };
};

function newsBag() {
  const g = globalThis as NewsBag;
  if (!g.__jinchaoNews) g.__jinchaoNews = { running: false };
  return g.__jinchaoNews;
}

export async function readNewsMeta(): Promise<NewsMeta> {
  return (
    (await readCacheFile<NewsMeta>(NEWS_META_CACHE)) ?? {
      syncing: false,
      lastPromoteAt: null,
      lastBuildAt: null,
      lastError: null,
    }
  );
}

async function writeNewsMeta(patch: Partial<NewsMeta>) {
  const prev = await readNewsMeta();
  await writeCacheFile(NEWS_META_CACHE, { ...prev, ...patch });
}

/** 抓 RSS → staging → 原子切 active（灰度） */
export async function rebuildNewsPayload(): Promise<NewsPayload> {
  await writeNewsMeta({ syncing: true, lastError: null });
  try {
    const collected: NewsItem[] = [];
    for (const feed of FEEDS) {
      const xml = await fetchFeed(feed.url);
      if (!xml) continue;
      collected.push(...parseRss(xml, feed.source));
    }

    // 去重（同標題或同連結）
    const seen = new Set<string>();
    const items = collected
      .filter((n) => {
        const key = `${n.title}|${n.link}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => {
        const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
        const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
        return tb - ta;
      })
      .slice(0, 40);

    if (!items.length) throw new Error("新聞來源無資料");

    const payload: NewsPayload = {
      items,
      builtAt: new Date().toISOString(),
      source: "google-news-rss",
      deploySlot: "staging",
    };
    await writeCacheFile(NEWS_STAGING_CACHE, payload);
    await writeCacheFile(NEWS_ACTIVE_CACHE, { ...payload, deploySlot: "active" });
    await writeNewsMeta({
      syncing: false,
      lastBuildAt: payload.builtAt,
      lastPromoteAt: payload.builtAt,
      lastError: null,
    });
    return { ...payload, deploySlot: "active" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeNewsMeta({ syncing: false, lastError: message });
    throw err;
  }
}

export function requestNewsRebuild(reason = "api"): {
  started: boolean;
  alreadyRunning: boolean;
} {
  const bag = newsBag();
  if (bag.running) return { started: false, alreadyRunning: true };
  bag.running = true;
  void rebuildNewsPayload()
    .then((p) => {
      console.log(`[news] ok (${reason}): items=${p.items.length}`);
    })
    .catch((err) => {
      console.error(`[news] failed (${reason}):`, err);
    })
    .finally(() => {
      bag.running = false;
    });
  return { started: true, alreadyRunning: false };
}

export async function getActiveNewsPayload(): Promise<NewsPayload> {
  const active = await readCacheFile<NewsPayload>(NEWS_ACTIVE_CACHE);
  if (active?.items?.length) return { ...active, deploySlot: "active" };
  const staging = await readCacheFile<NewsPayload>(NEWS_STAGING_CACHE);
  if (staging?.items?.length) return { ...staging, source: "cache", deploySlot: "staging" };
  return demoNews();
}
