/**
 * 官方產業分類（對齊證交所／櫃買 ISIN 產業別，接近三竹「產業類型」）。
 * 來源：https://isin.twse.com.tw/isin/C_public.jsp
 */

import iconv from "iconv-lite";
import {
  industryMegaGroup,
  industrySectorId,
  normalizeIndustryName,
  type IndustryMegaGroup,
} from "@/lib/industry-taxonomy";
import { readCacheFile, writeCacheFile } from "@/lib/tw-market";

export type IndustryStock = {
  code: string;
  name: string;
  /** 正規化後短名（聚合鍵／顯示） */
  industry: string;
  /** 電子／金融／傳產／其他 */
  megaGroup: IndustryMegaGroup;
  market: "twse" | "tpex";
};

export type IndustryMapPayload = {
  stocks: IndustryStock[];
  byCode: Record<string, IndustryStock>;
  industries: string[];
  builtAt: string;
  source: "isin";
};

const CACHE = "industry-map.json";

async function fetchIsinMode(mode: 2 | 4): Promise<IndustryStock[]> {
  const url = `https://isin.twse.com.tw/isin/C_public.jsp?strMode=${mode}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "JinMai/1.0 (industry-map; research)" },
    cache: "no-store",
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`ISIN HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const html = iconv.decode(buf, "big5");
  const market: "twse" | "tpex" = mode === 2 ? "twse" : "tpex";
  const out: IndustryStock[] = [];
  const re =
    /<td[^>]*>\s*(\d{4})\s*[　\s]+([^<]*?)\s*<\/td>\s*<td[^>]*>[^<]*<\/td>\s*<td[^>]*>[^<]*<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const code = m[1];
    const name = m[2].replace(/\s+/g, "").trim();
    const board = m[3].trim();
    const industryRaw = m[4].trim();
    if (!/^\d{4}$/.test(code)) continue;
    if (!industryRaw || /認購|認售|牛熊|ETF|ETN/.test(industryRaw)) continue;
    if (/認購|認售|牛熊|權證/.test(board)) continue;
    if (!name || name.length > 16) continue;
    const industry = normalizeIndustryName(industryRaw);
    if (!industry || industry.length < 2) continue;
    out.push({
      code,
      name,
      industry,
      megaGroup: industryMegaGroup(industry),
      market,
    });
  }
  return out;
}

function hydrateLegacy(cached: IndustryMapPayload): IndustryMapPayload {
  const stocks = (cached.stocks ?? []).map((s) => {
    const industry = normalizeIndustryName(s.industry);
    return {
      ...s,
      industry,
      megaGroup: s.megaGroup ?? industryMegaGroup(industry),
    };
  });
  const byCode: Record<string, IndustryStock> = {};
  for (const s of stocks) byCode[s.code] = s;
  const industries = [...new Set(stocks.map((s) => s.industry))].sort((a, b) =>
    a.localeCompare(b, "zh-Hant"),
  );
  return { ...cached, stocks, byCode, industries };
}

export async function loadIndustryMap(
  options?: { force?: boolean },
): Promise<IndustryMapPayload> {
  if (!options?.force) {
    const cached = await readCacheFile<IndustryMapPayload>(CACHE);
    if (cached?.stocks?.length && cached.builtAt) {
      const age = Date.now() - Date.parse(cached.builtAt);
      if (Number.isFinite(age) && age < 1000 * 60 * 60 * 24 * 3) {
        return hydrateLegacy(cached);
      }
    }
  }

  const [twse, tpex] = await Promise.all([
    fetchIsinMode(2).catch(() => [] as IndustryStock[]),
    fetchIsinMode(4).catch(() => [] as IndustryStock[]),
  ]);
  const merged = new Map<string, IndustryStock>();
  for (const s of [...twse, ...tpex]) {
    if (!merged.has(s.code)) merged.set(s.code, s);
  }
  const stocks = [...merged.values()];
  if (!stocks.length) {
    const cached = await readCacheFile<IndustryMapPayload>(CACHE);
    if (cached?.stocks?.length) return hydrateLegacy(cached);
    throw new Error("無法載入產業分類");
  }

  const byCode: Record<string, IndustryStock> = {};
  for (const s of stocks) byCode[s.code] = s;
  const industries = [...new Set(stocks.map((s) => s.industry))].sort((a, b) =>
    a.localeCompare(b, "zh-Hant"),
  );

  const payload: IndustryMapPayload = {
    stocks,
    byCode,
    industries,
    builtAt: new Date().toISOString(),
    source: "isin",
  };
  await writeCacheFile(CACHE, payload);
  return payload;
}

export { industrySectorId, normalizeIndustryName, industryMegaGroup };
