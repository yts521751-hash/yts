/**
 * Nasdaq Data Link（api.nasdaq.com）公開端點：
 * - 官方／綜合成交股數（比 Yahoo chart volume 更接近媒體「成值」）
 * - 全市場 screener（依成交金額挑流動普通股宇宙）
 * - 分析師年度 EPS 共識（免 Yahoo crumb）
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function nasdaqSymbol(code: string): string {
  // Nasdaq 用點號（BRK.B），宇宙內已是此格式
  return code.trim().toUpperCase().replace(/-/g, ".");
}

export function parseNasdaqNumber(raw: unknown): number | null {
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
 * 免 crumb，適合作 Yahoo quoteSummary 失敗時後備。
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

/** Screener 列（全市場；含 ETF／權證，呼叫端再濾） */
export type NasdaqScreenerRow = {
  symbol: string;
  name: string;
  lastSale: number;
  netChange: number;
  pctChange: number;
  volume: number;
  marketCap: number | null;
  /** lastSale × volume（美元） */
  dollarVolume: number;
  sector: string;
  industry: string;
};

type ScreenerRawRow = {
  symbol?: string;
  name?: string;
  lastsale?: string;
  netchange?: string;
  pctchange?: string;
  volume?: string;
  marketCap?: string;
  sector?: string;
  industry?: string;
};

/** 純函式：解析 screener rows → 結構化列（可單測） */
export function parseNasdaqScreenerRows(
  rows: ScreenerRawRow[] | null | undefined,
): NasdaqScreenerRow[] {
  const out: NasdaqScreenerRow[] = [];
  for (const r of rows ?? []) {
    const symbol = String(r.symbol || "")
      .trim()
      .toUpperCase();
    if (!symbol) continue;
    const lastSale = parseNasdaqNumber(r.lastsale) ?? 0;
    const volume = parseNasdaqNumber(r.volume) ?? 0;
    const netChange = parseNasdaqNumber(r.netchange) ?? 0;
    const pctChange = parseNasdaqNumber(r.pctchange) ?? 0;
    const marketCap = parseNasdaqNumber(r.marketCap);
    out.push({
      symbol,
      name: String(r.name || "").trim(),
      lastSale,
      netChange,
      pctChange,
      volume,
      marketCap: marketCap != null && marketCap > 0 ? marketCap : null,
      dollarVolume: Math.max(0, lastSale) * Math.max(0, volume),
      sector: String(r.sector || "").trim(),
      industry: String(r.industry || "").trim(),
    });
  }
  return out;
}

/**
 * 權證／認股權／單位等代號粗篩。
 * 保留 1–5 碼普通股（含 BE／F 等短碼、BRK.B）。
 */
export function isLikelyUsEquitySymbol(symbol: string): boolean {
  const c = symbol.trim().toUpperCase();
  if (!/^[A-Z]{1,5}(\.[A-Z])?$/.test(c)) return false;
  // 權證／權利／單位常見後綴（NIVFW、HPAIW…）
  if (/(WS|WT|WW)$/.test(c)) return false;
  if (c.length >= 5 && /[WRU]$/.test(c)) return false;
  return true;
}

/**
 * 依成交金額挑流動普通股（成值宇宙）。
 * - 排除 ETF／ETN／基金／信託／權證（名稱＋代號）
 * - 依 dollarVolume 降冪；可設最低成交金額門檻
 */
export function selectLiquidCommonByDollarVolume(
  rows: NasdaqScreenerRow[],
  options?: {
    limit?: number;
    /** 最低美元成交額；預設 5e7（0.5 億美元） */
    minDollarVolume?: number;
    isCommonStock?: (code: string, name?: string) => boolean;
  },
): NasdaqScreenerRow[] {
  const limit = Math.max(10, options?.limit ?? 120);
  const minDv = options?.minDollarVolume ?? 5e7;
  const isCommon =
    options?.isCommonStock ??
    ((code: string, name?: string) => {
      if (!isLikelyUsEquitySymbol(code)) return false;
      const n = (name || "").toUpperCase();
      if (
        /\b(ETF|ETN|TRUST|FUND|WARRANT|RIGHTS?|UNITS?|PREFERRED)\b/.test(n)
      ) {
        return false;
      }
      return true;
    });

  return rows
    .filter(
      (r) =>
        r.dollarVolume >= minDv &&
        r.lastSale > 0 &&
        r.volume > 0 &&
        isCommon(r.symbol, r.name),
    )
    .sort(
      (a, b) =>
        b.dollarVolume - a.dollarVolume || a.symbol.localeCompare(b.symbol),
    )
    .slice(0, limit);
}

/**
 * 全市場 screener download（約數千檔；含 volume／lastsale）。
 * 失敗回 null（呼叫端可回退宇宙日檔）。
 */
export async function fetchNasdaqScreenerStocks(): Promise<
  NasdaqScreenerRow[] | null
> {
  try {
    const url =
      "https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&offset=0&download=true";
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json,text/plain,*/*",
        Origin: "https://www.nasdaq.com",
        Referer: "https://www.nasdaq.com/market-activity/stocks/screener",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      data?: { rows?: ScreenerRawRow[] };
    };
    const parsed = parseNasdaqScreenerRows(data.data?.rows);
    return parsed.length >= 100 ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 成值候選宇宙：screener 依美元成交額取前 limit 檔普通股。
 * 另合併 marketmovers「MostActiveByDollarVolume」以免 screener 延遲漏熱門。
 */
export async function fetchNasdaqLiquidDollarVolumeUniverse(
  limit = 120,
  options?: {
    isCommonStock?: (code: string, name?: string) => boolean;
  },
): Promise<NasdaqScreenerRow[]> {
  const want = Math.min(300, Math.max(40, limit));
  const isCommon = options?.isCommonStock;
  const screener = (await fetchNasdaqScreenerStocks()) ?? [];
  const fromScreener = selectLiquidCommonByDollarVolume(screener, {
    limit: want,
    isCommonStock: isCommon,
  });

  // movers 補強（通常只有 ~20，且含 ETF；過濾後 merge）
  try {
    const url =
      "https://api.nasdaq.com/api/marketmovers?assetclass=stocks&limit=100";
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json,text/plain,*/*",
        Origin: "https://www.nasdaq.com",
        Referer: "https://www.nasdaq.com/market-activity/stocks",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        data?: {
          STOCKS?: {
            MostActiveByDollarVolume?: {
              table?: {
                rows?: Array<{
                  symbol?: string;
                  name?: string;
                  lastSalePrice?: string;
                  lastSaleChange?: string;
                  change?: string;
                }>;
              };
            };
          };
        };
      };
      const moverRows =
        data.data?.STOCKS?.MostActiveByDollarVolume?.table?.rows ?? [];
      const asScreener: NasdaqScreenerRow[] = [];
      for (const r of moverRows) {
        const symbol = String(r.symbol || "")
          .trim()
          .toUpperCase();
        const lastSale = parseNasdaqNumber(r.lastSalePrice) ?? 0;
        // movers 的 change 欄是 share volume（非漲跌）
        const volume = parseNasdaqNumber(r.change) ?? 0;
        const netChange = parseNasdaqNumber(r.lastSaleChange) ?? 0;
        if (!symbol || !(lastSale > 0)) continue;
        asScreener.push({
          symbol,
          name: String(r.name || "").trim(),
          lastSale,
          netChange,
          pctChange: 0,
          volume,
          marketCap: null,
          dollarVolume: lastSale * Math.max(0, volume),
          sector: "",
          industry: "",
        });
      }
      const fromMovers = selectLiquidCommonByDollarVolume(asScreener, {
        limit: want,
        minDollarVolume: 1e7,
        isCommonStock: isCommon,
      });
      const bySym = new Map<string, NasdaqScreenerRow>();
      for (const r of fromScreener) bySym.set(r.symbol, r);
      for (const r of fromMovers) {
        const prev = bySym.get(r.symbol);
        if (!prev || r.dollarVolume > prev.dollarVolume) bySym.set(r.symbol, r);
      }
      return [...bySym.values()]
        .sort(
          (a, b) =>
            b.dollarVolume - a.dollarVolume ||
            a.symbol.localeCompare(b.symbol),
        )
        .slice(0, want);
    }
  } catch {
    /* movers optional */
  }

  return fromScreener;
}
