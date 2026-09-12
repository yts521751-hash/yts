/**
 * 個股基本面補強（公開資訊，非寫死）：
 * - 最近月營收 YoY：證交所／櫃買 OpenAPI 月營收
 * - EPS 成長率：優先取全市場法人報告共識（Cnyes／FactSet 各家預估平均 feMean），
 *   再回退 Yahoo 共識、最後才用公開財報近四季年增推估
 */

import { loadIndustryMap } from "@/lib/industry-map";
import {
  fetchJson,
  fetchJsonViaCurl,
  readCacheFile,
  writeCacheFile,
} from "@/lib/tw-market";

export type StockFundamentals = {
  /** 最近月營收年增率 % */
  revenueYoy: number | null;
  /** 營收資料年月 */
  revenueMonth: string | null;
  /** 市場共識下一年平均 EPS */
  nextYearEps: number | null;
  /** 基準 EPS（本年度共識或近四季） */
  baseEps: number | null;
  /** EPS 成長率 %＝(下一年平均 − 基準)／|基準| */
  epsGrowth: number | null;
  epsSource: string | null;
};

type RevenueCache = {
  builtAt: string;
  month: string | null;
  byCode: Record<string, { yoy: number; month: string }>;
};

type EpsEntry = {
  nextYearEps: number | null;
  baseEps: number | null;
  epsGrowth: number | null;
  epsSource: string | null;
};

type EpsCache = {
  builtAt: string;
  byCode: Record<string, EpsEntry>;
};

type YahooAuth = { crumb: string; jar: string; at: number };

const REVENUE_CACHE = "fundamentals-revenue.json";
const EPS_CACHE = "fundamentals-eps.json";
const REVENUE_TTL_MS = 12 * 60 * 60 * 1000;
const EPS_TTL_MS = 12 * 60 * 60 * 1000;

let yahooAuth: YahooAuth | null = null;

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

function parseNum(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/,/g, "").replace(/%/g, "").trim();
  if (!cleaned || cleaned === "-" || cleaned === "--" || cleaned === "---") {
    return null;
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function pickYoy(row: Record<string, string>): number | null {
  const direct = parseNum(row["營業收入-去年同月增減(%)"]);
  if (direct != null) return direct;
  for (const [k, v] of Object.entries(row)) {
    if (k.includes("去年同月") && k.includes("%")) {
      const n = parseNum(v);
      if (n != null) return n;
    }
  }
  return null;
}

async function loadRevenueMap(force = false): Promise<RevenueCache> {
  if (!force) {
    const cached = await readCacheFile<RevenueCache>(REVENUE_CACHE);
    if (cached?.byCode && cached.builtAt) {
      const age = Date.now() - Date.parse(cached.builtAt);
      if (Number.isFinite(age) && age >= 0 && age < REVENUE_TTL_MS) return cached;
    }
  }

  type RawRow = Record<string, string>;
  const twseUrl = "https://openapi.twse.com.tw/v1/opendata/t187ap05_L";
  const tpexUrl = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O";

  const [twse, tpex] = await Promise.all([
    (await fetchJsonViaCurl<RawRow[]>(twseUrl)) ??
      (await fetchJson<RawRow[]>(twseUrl)),
    (await fetchJsonViaCurl<RawRow[]>(tpexUrl)) ??
      (await fetchJson<RawRow[]>(tpexUrl)),
  ]);

  const byCode: RevenueCache["byCode"] = {};
  let latestMonth: string | null = null;

  const ingest = (rows: RawRow[] | null | undefined) => {
    if (!rows?.length) return;
    for (const row of rows) {
      const code = String(row["公司代號"] ?? "").trim();
      if (!/^\d{4}$/.test(code)) continue;
      const month = String(row["資料年月"] ?? "").trim();
      const yoy = pickYoy(row);
      if (yoy == null) continue;
      byCode[code] = { yoy: round1(yoy), month: month || "—" };
      if (month && (!latestMonth || month > latestMonth)) latestMonth = month;
    }
  };

  ingest(twse ?? undefined);
  ingest(tpex ?? undefined);

  const payload: RevenueCache = {
    builtAt: new Date().toISOString(),
    month: latestMonth,
    byCode,
  };
  if (Object.keys(byCode).length) await writeCacheFile(REVENUE_CACHE, payload);
  return payload;
}

async function getYahooAuth(): Promise<YahooAuth | null> {
  if (yahooAuth && Date.now() - yahooAuth.at < 30 * 60 * 1000) return yahooAuth;
  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const fs = await import("fs/promises");
    const run = promisify(execFile);
    const jar = `/tmp/yahoo-crumb-${process.pid}.txt`;
    await run(
      "curl",
      [
        "-sS",
        "-c",
        jar,
        "-b",
        jar,
        "-A",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "-o",
        "/dev/null",
        "https://fc.yahoo.com",
      ],
      { timeout: 20000 },
    );
    const { stdout } = await run(
      "curl",
      [
        "-sS",
        "-c",
        jar,
        "-b",
        jar,
        "-A",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "https://query1.finance.yahoo.com/v1/test/getcrumb",
      ],
      { timeout: 20000 },
    );
    const crumb = String(stdout || "").trim();
    if (!crumb || crumb.includes("<") || crumb.includes(" ")) return null;
    // 保留 cookie jar 路徑供後續 curl -b 使用（#HttpOnly_ 列不能當註解丟掉）
    yahooAuth = { crumb, jar, at: Date.now() };
    return yahooAuth;
  } catch {
    return null;
  }
}

type CnyesEpsRow = {
  financialYear?: number;
  feMean?: number | null;
  numEst?: number | null;
  rateDate?: string | null;
};

/** 全市場法人／外資預估 EPS 平均（Cnyes 轉發 FactSet estimateProfit） */
async function fetchCnyesFactsetEps(code: string): Promise<EpsEntry | null> {
  const symbol = `TWS:${code}:STOCK`;
  const url =
    "https://marketinfo.api.cnyes.com/mi/api/v1/financialIndicator/estimateProfit/" +
    `${encodeURIComponent(symbol)}?type=eps`;
  try {
    const payload =
      (await fetchJsonViaCurl<{
        statusCode?: number;
        data?: CnyesEpsRow[] | null;
      }>(url)) ??
      (await fetchJson<{
        statusCode?: number;
        data?: CnyesEpsRow[] | null;
      }>(url));
    const rows = (payload?.data ?? []).filter(
      (r) =>
        typeof r.financialYear === "number" &&
        typeof r.feMean === "number" &&
        Number.isFinite(r.feMean) &&
        (r.numEst == null || r.numEst > 0),
    );
    if (rows.length < 2) return null;

    const byYear = new Map<number, CnyesEpsRow>();
    for (const row of rows) {
      const year = row.financialYear!;
      const prev = byYear.get(year);
      // 同年度取預估家數較多者
      if (!prev || (row.numEst ?? 0) >= (prev.numEst ?? 0)) {
        byYear.set(year, row);
      }
    }

    const calendarYear = new Date().getFullYear();
    let cur = byYear.get(calendarYear) ?? null;
    let next = byYear.get(calendarYear + 1) ?? null;

    // 若今年／明年缺資料，改取連續兩年、且家數較完整的一組
    if (!cur || !next) {
      const years = [...byYear.keys()].sort((a, b) => a - b);
      let best: { cur: CnyesEpsRow; next: CnyesEpsRow; score: number } | null =
        null;
      for (let i = 0; i < years.length - 1; i++) {
        const a = byYear.get(years[i])!;
        const b = byYear.get(years[i + 1])!;
        if (years[i + 1] !== years[i] + 1) continue;
        const score =
          (a.numEst ?? 0) +
          (b.numEst ?? 0) -
          Math.abs(years[i] - calendarYear) * 0.01;
        if (!best || score > best.score) best = { cur: a, next: b, score };
      }
      if (!best) return null;
      cur = best.cur;
      next = best.next;
    }

    const nextYearEps = next.feMean!;
    const baseEps = cur.feMean!;
    if (!baseEps) return null;
    const epsGrowth = round1(
      ((nextYearEps - baseEps) / Math.abs(baseEps)) * 100,
    );
    const nCur = cur.numEst ?? 0;
    const nNext = next.numEst ?? 0;
    return {
      nextYearEps: round2(nextYearEps),
      baseEps: round2(baseEps),
      epsGrowth,
      epsSource: `cnyes-factset-mean:${code}:fy${cur.financialYear}->${next.financialYear}:n=${nCur}/${nNext}`,
    };
  } catch {
    return null;
  }
}

function yahooSymbols(code: string, market: "twse" | "tpex" | undefined) {
  if (market === "tpex") return [`${code}.TWO`, `${code}.TW`];
  return [`${code}.TW`, `${code}.TWO`];
}

async function fetchYahooEps(
  code: string,
  market: "twse" | "tpex" | undefined,
  auth: YahooAuth,
): Promise<EpsEntry | null> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const run = promisify(execFile);

  for (const symbol of yahooSymbols(code, market)) {
    try {
      const url =
        `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
        `?modules=earningsTrend,defaultKeyStatistics&crumb=${encodeURIComponent(auth.crumb)}`;
      const { stdout } = await run(
        "curl",
        [
          "-sS",
          "-b",
          auth.jar,
          "-c",
          auth.jar,
          "-A",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
          url,
        ],
        { timeout: 20000, maxBuffer: 2 * 1024 * 1024 },
      );
      const data = JSON.parse(String(stdout || "{}")) as {
        quoteSummary?: {
          result?: Array<{
            defaultKeyStatistics?: { trailingEps?: { raw?: number } };
            earningsTrend?: {
              trend?: Array<{
                period?: string;
                earningsEstimate?: { avg?: { raw?: number } };
                growth?: { raw?: number };
              }>;
            };
          }>;
        };
      };
      const result = data.quoteSummary?.result?.[0];
      if (!result) continue;
      const byPeriod = new Map(
        (result.earningsTrend?.trend ?? []).map((t) => [t.period, t]),
      );
      const next = byPeriod.get("+1y");
      const cur = byPeriod.get("0y");
      const nextYearEps = next?.earningsEstimate?.avg?.raw ?? null;
      const yearEps = cur?.earningsEstimate?.avg?.raw ?? null;
      const trailing = result.defaultKeyStatistics?.trailingEps?.raw ?? null;
      const baseEps =
        yearEps != null && yearEps !== 0
          ? yearEps
          : trailing != null && trailing !== 0
            ? trailing
            : null;
      let epsGrowth: number | null = null;
      if (nextYearEps != null && baseEps != null && baseEps !== 0) {
        epsGrowth = round1(((nextYearEps - baseEps) / Math.abs(baseEps)) * 100);
      } else if (next?.growth?.raw != null) {
        epsGrowth = round1(next.growth.raw * 100);
      }
      return {
        nextYearEps: nextYearEps != null ? round2(nextYearEps) : null,
        baseEps: baseEps != null ? round2(baseEps) : null,
        epsGrowth,
        epsSource: `yahoo-consensus:${symbol}`,
      };
    } catch {
      /* try next symbol */
    }
  }
  return null;
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx]);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, Math.max(items.length, 1)) },
      () => run(),
    ),
  );
}


async function fetchFinmindTtmGrowth(code: string): Promise<EpsEntry | null> {
  try {
    const url =
      "https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockFinancialStatements" +
      `&data_id=${encodeURIComponent(code)}&start_date=2022-01-01`;
    const payload =
      (await fetchJsonViaCurl<{
        data?: Array<{ date: string; type: string; value: number }>;
      }>(url)) ??
      (await fetchJson<{
        data?: Array<{ date: string; type: string; value: number }>;
      }>(url));
    const rows = (payload?.data ?? [])
      .filter((r) => r.type === "EPS" && Number.isFinite(r.value))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (rows.length < 8) return null;
    const last4 = rows.slice(-4);
    const prev4 = rows.slice(-8, -4);
    const ttm = last4.reduce((s, r) => s + r.value, 0);
    const prior = prev4.reduce((s, r) => s + r.value, 0);
    if (!prior) return null;
    const growth = round1(((ttm - prior) / Math.abs(prior)) * 100);
    const nextYear = round2(ttm * (1 + growth / 100));
    return {
      nextYearEps: nextYear,
      baseEps: round2(ttm),
      epsGrowth: growth,
      epsSource: "finmind-ttm-yoy-projected",
    };
  } catch {
    return null;
  }
}

/** 為排行個股補上營收 YoY 與 EPS 成長率 */
export async function enrichStockFundamentals(
  codes: string[],
  options?: { force?: boolean },
): Promise<Map<string, StockFundamentals>> {
  const uniq = [...new Set(codes.filter((c) => /^\d{4}$/.test(c)))];
  const result = new Map<string, StockFundamentals>();
  if (!uniq.length) return result;

  const revenue = await loadRevenueMap(Boolean(options?.force));
  let epsCache =
    (await readCacheFile<EpsCache>(EPS_CACHE)) ?? {
      builtAt: "",
      byCode: {},
    };
  const epsAge = Date.now() - Date.parse(epsCache.builtAt || "");
  const epsFresh =
    !options?.force &&
    Number.isFinite(epsAge) &&
    epsAge >= 0 &&
    epsAge < EPS_TTL_MS;

  const industry = await loadIndustryMap().catch(() => null);
  const needEps = uniq.filter((code) => {
    const entry = epsCache.byCode[code];
    if (!entry?.epsSource) return true;
    // 舊版 Yahoo／財報推估快取改抓全市場法人共識平均
    if (!entry.epsSource.startsWith("cnyes-factset-mean:")) return true;
    if (!epsFresh) return true;
    return false;
  });

  if (needEps.length) {
    const auth = await getYahooAuth();
    await mapPool(needEps, 4, async (code) => {
      const market = industry?.byCode?.[code]?.market;
      // 優先：全市場法人報告共識平均（FactSet via Cnyes）
      let eps = await fetchCnyesFactsetEps(code);
      if (!eps && auth) eps = await fetchYahooEps(code, market, auth);
      if (!eps) eps = await fetchFinmindTtmGrowth(code);
      if (eps) epsCache.byCode[code] = eps;
    });
    epsCache.builtAt = new Date().toISOString();
    await writeCacheFile(EPS_CACHE, epsCache);
  }

  for (const code of uniq) {
    const rev = revenue.byCode[code];
    const eps = epsCache.byCode[code];
    result.set(code, {
      revenueYoy: rev?.yoy ?? null,
      revenueMonth: rev?.month ?? revenue.month,
      nextYearEps: eps?.nextYearEps ?? null,
      baseEps: eps?.baseEps ?? null,
      epsGrowth: eps?.epsGrowth ?? null,
      epsSource: eps?.epsSource ?? null,
    });
  }
  return result;
}
