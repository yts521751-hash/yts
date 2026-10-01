/**
 * Nasdaq Data Link（api.nasdaq.com）公開端點：
 * - 官方／綜合成交股數（比 Yahoo chart volume 更接近媒體「成值」）
 * - 分析師年度 EPS 共識（免 Yahoo crumb）
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function nasdaqSymbol(code: string): string {
  // Nasdaq 用點號（BRK.B），宇宙內已是此格式
  return code.trim().toUpperCase().replace(/-/g, ".");
}

function parseNasdaqNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string") return null;
  const n = Number(raw.replace(/[$,%]/g, "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

/** 去掉 Common Stock／Ordinary Shares 等後綴，留可讀英文名 */
export function cleanNasdaqCompanyName(raw: string | null | undefined): string {
  let s = String(raw || "").trim();
  if (!s) return "";
  s = s
    .replace(/\s+Common Stock$/i, "")
    .replace(/\s+Ordinary Shares$/i, "")
    .replace(/\s+Class [A-Z]\b.*$/i, "")
    .replace(/,?\s+Inc\.?$/i, "")
    .replace(/,?\s+Corporation$/i, "")
    .replace(/,?\s+Corp\.?$/i, "")
    .replace(/,?\s+Ltd\.?$/i, "")
    .replace(/,?\s+Limited$/i, "")
    .replace(/,?\s+Company$/i, "")
    .replace(/,?\s+Co\.?$/i, "")
    .replace(/,\s*$/g, "")
    .trim();
  return s || String(raw || "").trim();
}

export type NasdaqQuoteInfo = {
  symbol: string;
  companyName: string;
  /** 官方 Share Volume（股） */
  volume: number | null;
  lastPrice: number | null;
};

export async function fetchNasdaqQuoteInfo(
  code: string,
): Promise<NasdaqQuoteInfo | null> {
  const symbol = nasdaqSymbol(code);
  try {
    const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/info?assetclass=stocks`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json,text/plain,*/*",
        Origin: "https://www.nasdaq.com",
        Referer: `https://www.nasdaq.com/market-activity/stocks/${symbol.toLowerCase()}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      data?: {
        symbol?: string;
        companyName?: string;
        primaryData?: {
          lastSalePrice?: string;
          volume?: string;
        };
      };
    };
    const primary = data.data?.primaryData;
    if (!primary && !data.data?.companyName) return null;
    return {
      symbol,
      companyName: String(data.data?.companyName || "").trim(),
      volume: parseNasdaqNumber(primary?.volume),
      lastPrice: parseNasdaqNumber(primary?.lastSalePrice),
    };
  } catch {
    return null;
  }
}

export type NasdaqYearlyEps = {
  baseEps: number;
  nextYearEps: number;
  baseFy: string;
  nextFy: string;
  source: string;
};

/**
 * 年度 EPS 共識：yearlyForecast.rows[0]=當前財年、rows[1]=下一財年。
 * 免 crumb，適合作 Yahoo quoteSummary 後援。
 */
export async function fetchNasdaqYearlyEps(
  code: string,
): Promise<NasdaqYearlyEps | null> {
  const symbol = nasdaqSymbol(code);
  try {
    const url = `https://api.nasdaq.com/api/analyst/${encodeURIComponent(symbol)}/earnings-forecast`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json,text/plain,*/*",
        Origin: "https://www.nasdaq.com",
        Referer: `https://www.nasdaq.com/market-activity/stocks/${symbol.toLowerCase()}/earnings`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      data?: {
        yearlyForecast?: {
          rows?: Array<{
            fiscalEnd?: string;
            consensusEPSForecast?: number | string;
            noOfEstimates?: number;
          }>;
        };
      };
    };
    const rows = data.data?.yearlyForecast?.rows ?? [];
    if (rows.length < 2) return null;
    const base = parseNasdaqNumber(rows[0]?.consensusEPSForecast);
    const next = parseNasdaqNumber(rows[1]?.consensusEPSForecast);
    if (base == null || next == null || !(base > 0) || !(next > 0)) return null;
    return {
      baseEps: base,
      nextYearEps: next,
      baseFy: String(rows[0]?.fiscalEnd || ""),
      nextFy: String(rows[1]?.fiscalEnd || ""),
      source: `nasdaq-yearly:${symbol}`,
    };
  } catch {
    return null;
  }
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, Math.max(1, items.length)) },
      async () => {
        while (i < items.length) {
          const idx = i++;
          out[idx] = await fn(items[idx]);
          await sleep(40);
        }
      },
    ),
  );
  return out;
}

/** 批次抓 Nasdaq 報價（成交量／公司名）；失敗者略過 */
export async function fetchNasdaqQuoteInfoMap(
  codes: string[],
  concurrency = 6,
): Promise<Map<string, NasdaqQuoteInfo>> {
  const uniq = [...new Set(codes.map((c) => c.toUpperCase()))];
  const map = new Map<string, NasdaqQuoteInfo>();
  await mapPool(uniq, concurrency, async (code) => {
    const info = await fetchNasdaqQuoteInfo(code);
    if (info) map.set(code, info);
  });
  return map;
}
