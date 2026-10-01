/**
 * 個股基本面補強（公開資訊，非寫死）：
 * - 最近月營收 YoY：證交所／櫃買 OpenAPI 月營收
 * - EPS 成長率：優先取全市場法人報告共識（Cnyes／FactSet 各家預估中位數 feMedian），
 *   再回退 Yahoo 共識、最後才用公開財報近四季年增推估
 * - 明年 EPS 依據：若來源有逐家券商列則保留；否則降級為共識統計（高／低／均／中位／家數）
 */

import { loadIndustryMap } from "@/lib/industry-map";
import {
  fetchJson,
  fetchJsonViaCurl,
  readCacheFile,
  writeCacheFile,
} from "@/lib/tw-market";

/** 單一券商／外資對明年 EPS 的預估列（來源有提供時） */
export type BrokerEpsEstimate = {
  /** 券商／外資名稱；共識列可用「FactSet 共識中位數」等 */
  broker: string;
  /** EPS 預估值 */
  eps: number;
  /** 目標會計年度（西元） */
  targetYear?: number | null;
  /** 估計日 YYYY-MM-DD */
  asOf?: string | null;
  /** domestic | foreign | consensus | unknown */
  kind?: "domestic" | "foreign" | "consensus" | "unknown";
};

/** 共識統計（無逐家列時的降級依據） */
export type EpsConsensusBasis = {
  targetYear: number | null;
  median: number | null;
  mean: number | null;
  high: number | null;
  low: number | null;
  numEst: number | null;
  rateDate: string | null;
  source: string;
};

export type StockFundamentals = {
  /** 最近月營收年增率 % */
  revenueYoy: number | null;
  /** 營收資料年月 */
  revenueMonth: string | null;
  /** 市場共識下一年 EPS（法人預估中位數） */
  nextYearEps: number | null;
  /** 基準 EPS（本年度共識中位數或近四季） */
  baseEps: number | null;
  /** EPS 成長率 %＝(下一年中位數 − 基準)／|基準| */
  epsGrowth: number | null;
  epsSource: string | null;
  /** 明年 EPS 逐家／共識列（可為空） */
  brokers?: BrokerEpsEstimate[];
  /** 明年 EPS 共識統計（無逐家時仍可展開顯示） */
  consensusBasis?: EpsConsensusBasis | null;
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
  brokers?: BrokerEpsEstimate[];
  consensusBasis?: EpsConsensusBasis | null;
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

async function loadRevenueMap(
  force = false,
  options?: { preferStale?: boolean },
): Promise<RevenueCache> {
  if (!force) {
    const cached = await readCacheFile<RevenueCache>(REVENUE_CACHE);
    if (cached?.byCode && cached.builtAt) {
      const age = Date.now() - Date.parse(cached.builtAt);
      if (Number.isFinite(age) && age >= 0 && age < REVENUE_TTL_MS) {
        return cached;
      }
      // 單股查詢：寧可舊營收也不要卡住整份市場月營收重抓
      if (options?.preferStale && Object.keys(cached.byCode).length) {
        return cached;
      }
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
    yahooAuth = { crumb, jar, at: Date.now() };
    return yahooAuth;
  } catch {
    return null;
  }
}

type CnyesEpsRow = {
  financialYear?: number;
  feMean?: number | null;
  feMedian?: number | null;
  feHigh?: number | null;
  feLow?: number | null;
  numEst?: number | null;
  rateDate?: string | null;
  /** 若 API 將來回傳逐家列，儘量解析 */
  brokers?: unknown;
  estimates?: unknown;
  details?: unknown;
};

function cnyesEpsValue(row: CnyesEpsRow): number | null {
  if (typeof row.feMedian === "number" && Number.isFinite(row.feMedian)) {
    return row.feMedian;
  }
  if (typeof row.feMean === "number" && Number.isFinite(row.feMean)) {
    return row.feMean;
  }
  return null;
}

function parseBrokerList(
  raw: unknown,
  targetYear: number | null | undefined,
  rateDate: string | null | undefined,
): BrokerEpsEstimate[] {
  if (!Array.isArray(raw) || !raw.length) return [];
  const out: BrokerEpsEstimate[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const broker = String(
      row.broker ??
        row.brokerName ??
        row.institution ??
        row.orgName ??
        row.name ??
        row.firm ??
        "",
    ).trim();
    const eps =
      parseNum(row.eps) ??
      parseNum(row.estimate) ??
      parseNum(row.value) ??
      parseNum(row.feMean) ??
      parseNum(row.targetEps);
    if (!broker || eps == null) continue;
    out.push({
      broker,
      eps: round2(eps),
      targetYear: targetYear ?? parseNum(row.financialYear) ?? null,
      asOf:
        (typeof row.rateDate === "string" && row.rateDate) ||
        (typeof row.asOf === "string" && row.asOf) ||
        rateDate ||
        null,
      kind: "unknown",
    });
  }
  return out;
}

function consensusRowsFromCnyes(
  next: CnyesEpsRow,
  sourceTag: string,
): { brokers: BrokerEpsEstimate[]; consensusBasis: EpsConsensusBasis } {
  const year = next.financialYear ?? null;
  const rateDate = next.rateDate ?? null;
  const median =
    typeof next.feMedian === "number" && Number.isFinite(next.feMedian)
      ? round2(next.feMedian)
      : null;
  const mean =
    typeof next.feMean === "number" && Number.isFinite(next.feMean)
      ? round2(next.feMean)
      : null;
  const high =
    typeof next.feHigh === "number" && Number.isFinite(next.feHigh)
      ? round2(next.feHigh)
      : null;
  const low =
    typeof next.feLow === "number" && Number.isFinite(next.feLow)
      ? round2(next.feLow)
      : null;
  const numEst =
    typeof next.numEst === "number" && Number.isFinite(next.numEst)
      ? next.numEst
      : null;

  const brokersFromApi = [
    ...parseBrokerList(next.brokers, year, rateDate),
    ...parseBrokerList(next.estimates, year, rateDate),
    ...parseBrokerList(next.details, year, rateDate),
  ];

  const brokers: BrokerEpsEstimate[] =
    brokersFromApi.length > 0
      ? brokersFromApi
      : [
          ...(median != null
            ? [
                {
                  broker: "FactSet 共識中位數",
                  eps: median,
                  targetYear: year,
                  asOf: rateDate,
                  kind: "consensus" as const,
                },
              ]
            : []),
          ...(mean != null && mean !== median
            ? [
                {
                  broker: "FactSet 共識平均",
                  eps: mean,
                  targetYear: year,
                  asOf: rateDate,
                  kind: "consensus" as const,
                },
              ]
            : []),
          ...(high != null
            ? [
                {
                  broker: "FactSet 最高估",
                  eps: high,
                  targetYear: year,
                  asOf: rateDate,
                  kind: "consensus" as const,
                },
              ]
            : []),
          ...(low != null
            ? [
                {
                  broker: "FactSet 最低估",
                  eps: low,
                  targetYear: year,
                  asOf: rateDate,
                  kind: "consensus" as const,
                },
              ]
            : []),
        ];

  return {
    brokers,
    consensusBasis: {
      targetYear: year,
      median,
      mean,
      high,
      low,
      numEst,
      rateDate,
      source: sourceTag,
    },
  };
}

/** 短逾時 JSON（單股查詢用；避免 curl 預設 120s） */
async function fetchJsonQuick<T>(
  url: string,
  timeoutMs = 5000,
): Promise<T | null> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "JinMai/1.0 (fundamentals; lookup)",
        Accept: "application/json,text/plain,*/*",
      },
      cache: "no-store",
      signal: ac.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** 全市場法人／外資預估 EPS 中位數（Cnyes 轉發 FactSet estimateProfit） */
async function fetchCnyesFactsetEps(
  code: string,
  options?: { quick?: boolean },
): Promise<EpsEntry | null> {
  const symbol = `TWS:${code}:STOCK`;
  const url =
    "https://marketinfo.api.cnyes.com/mi/api/v1/financialIndicator/estimateProfit/" +
    `${encodeURIComponent(symbol)}?type=eps`;
  try {
    type Payload = {
      statusCode?: number;
      data?: CnyesEpsRow[] | null;
    };
    const payload = options?.quick
      ? ((await fetchJsonQuick<Payload>(url, 4500)) ??
        (await fetchJson<Payload>(url, 1)))
      : ((await fetchJsonViaCurl<Payload>(url)) ??
        (await fetchJson<Payload>(url)));
    const rows = (payload?.data ?? []).filter((r) => {
      if (typeof r.financialYear !== "number") return false;
      if (cnyesEpsValue(r) == null) return false;
      if (r.numEst != null && r.numEst <= 0) return false;
      return true;
    });
    if (rows.length < 2) return null;

    const byYear = new Map<number, CnyesEpsRow>();
    for (const row of rows) {
      const year = row.financialYear!;
      const prev = byYear.get(year);
      if (!prev || (row.numEst ?? 0) >= (prev.numEst ?? 0)) {
        byYear.set(year, row);
      }
    }

    const calendarYear = new Date().getFullYear();
    let cur = byYear.get(calendarYear) ?? null;
    let next = byYear.get(calendarYear + 1) ?? null;

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

    const nextYearEps = cnyesEpsValue(next)!;
    const baseEps = cnyesEpsValue(cur)!;
    if (!baseEps) return null;
    const epsGrowth = round1(
      ((nextYearEps - baseEps) / Math.abs(baseEps)) * 100,
    );
    const nCur = cur.numEst ?? 0;
    const nNext = next.numEst ?? 0;
    const usedMedian =
      typeof next.feMedian === "number" && typeof cur.feMedian === "number";
    const sourceTag = `cnyes-factset-${usedMedian ? "median" : "mean"}:${code}:fy${cur.financialYear}->${next.financialYear}:n=${nCur}/${nNext}`;
    const { brokers, consensusBasis } = consensusRowsFromCnyes(next, sourceTag);
    return {
      nextYearEps: round2(nextYearEps),
      baseEps: round2(baseEps),
      epsGrowth,
      epsSource: sourceTag,
      brokers,
      consensusBasis,
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
                endDate?: string;
                earningsEstimate?: {
                  avg?: { raw?: number };
                  low?: { raw?: number };
                  high?: { raw?: number };
                  numberOfAnalysts?: { raw?: number };
                };
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
      const sourceTag = `yahoo-consensus:${symbol}`;
      const est = next?.earningsEstimate;
      const brokers: BrokerEpsEstimate[] = [];
      if (nextYearEps != null) {
        brokers.push({
          broker: "Yahoo 分析師平均",
          eps: round2(nextYearEps),
          targetYear: null,
          asOf: next?.endDate ?? null,
          kind: "consensus",
        });
      }
      if (est?.high?.raw != null) {
        brokers.push({
          broker: "Yahoo 最高估",
          eps: round2(est.high.raw),
          kind: "consensus",
        });
      }
      if (est?.low?.raw != null) {
        brokers.push({
          broker: "Yahoo 最低估",
          eps: round2(est.low.raw),
          kind: "consensus",
        });
      }
      return {
        nextYearEps: nextYearEps != null ? round2(nextYearEps) : null,
        baseEps: baseEps != null ? round2(baseEps) : null,
        epsGrowth,
        epsSource: sourceTag,
        brokers,
        consensusBasis: {
          targetYear: null,
          median: null,
          mean: nextYearEps != null ? round2(nextYearEps) : null,
          high: est?.high?.raw != null ? round2(est.high.raw) : null,
          low: est?.low?.raw != null ? round2(est.low.raw) : null,
          numEst: est?.numberOfAnalysts?.raw ?? null,
          rateDate: next?.endDate ?? null,
          source: sourceTag,
        },
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
    const sourceTag = "finmind-ttm-yoy-projected";
    return {
      nextYearEps: nextYear,
      baseEps: round2(ttm),
      epsGrowth: growth,
      epsSource: sourceTag,
      brokers: [
        {
          broker: "FinMind 近四季年增推估",
          eps: nextYear,
          asOf: last4[last4.length - 1]?.date ?? null,
          kind: "consensus",
        },
      ],
      consensusBasis: {
        targetYear: null,
        median: null,
        mean: nextYear,
        high: null,
        low: null,
        numEst: null,
        rateDate: last4[last4.length - 1]?.date ?? null,
        source: sourceTag,
      },
    };
  } catch {
    return null;
  }
}

/** 為排行個股補上營收 YoY 與 EPS 成長率 */
export async function enrichStockFundamentals(
  codes: string[],
  options?: {
    force?: boolean;
    /** 單股查詢：接受過期快取、短逾時、不預先打 Yahoo crumb */
    preferStale?: boolean;
  },
): Promise<Map<string, StockFundamentals>> {
  const uniq = [...new Set(codes.filter((c) => /^\d{4}$/.test(c)))];
  const result = new Map<string, StockFundamentals>();
  if (!uniq.length) return result;

  const preferStale = Boolean(options?.preferStale) && !options?.force;
  const quick = preferStale || uniq.length <= 2;

  const [revenue, epsCacheRaw, industry] = await Promise.all([
    loadRevenueMap(Boolean(options?.force), { preferStale }),
    readCacheFile<EpsCache>(EPS_CACHE),
    loadIndustryMap().catch(() => null),
  ]);
  let epsCache = epsCacheRaw ?? { builtAt: "", byCode: {} };
  const epsAge = Date.now() - Date.parse(epsCache.builtAt || "");
  const epsFresh =
    !options?.force &&
    Number.isFinite(epsAge) &&
    epsAge >= 0 &&
    epsAge < EPS_TTL_MS;

  const needEps = uniq.filter((code) => {
    const entry = epsCache.byCode[code];
    if (!entry?.epsSource) return true;
    // 單股查詢：只要有可用 EPS 數字就先回，不必同步補 brokers／重抓
    if (preferStale && entry.nextYearEps != null && entry.baseEps != null) {
      return false;
    }
    // 舊版 Yahoo／平均／財報推估快取改抓全市場法人共識中位數
    if (!entry.epsSource.startsWith("cnyes-factset-median:")) return true;
    // 舊快取缺依據列 → 重抓一次補 brokers／consensusBasis
    if (!entry.brokers?.length && !entry.consensusBasis) return true;
    if (!epsFresh) return true;
    return false;
  });

  if (needEps.length) {
    // 先並行打 Cnyes；只有仍缺資料才取 Yahoo crumb（避免每次查詢卡 20s+）
    await mapPool(needEps, quick ? 2 : 4, async (code) => {
      const eps = await fetchCnyesFactsetEps(code, { quick });
      if (eps) epsCache.byCode[code] = eps;
    });
    const stillNeed = needEps.filter((code) => !epsCache.byCode[code]?.epsSource);

    if (stillNeed.length) {
      const auth = await getYahooAuth();
      await mapPool(stillNeed, quick ? 2 : 4, async (code) => {
        const market = industry?.byCode?.[code]?.market;
        let eps = auth ? await fetchYahooEps(code, market, auth) : null;
        if (!eps) eps = await fetchFinmindTtmGrowth(code);
        if (eps) epsCache.byCode[code] = eps;
      });
    }

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
      brokers: eps?.brokers ?? [],
      consensusBasis: eps?.consensusBasis ?? null,
    });
  }
  return result;
}

/** 讀單一代號基本面（沿用快取；缺則抓） */
export async function getStockFundamentals(
  code: string,
  options?: { force?: boolean; preferStale?: boolean },
): Promise<StockFundamentals | null> {
  if (!/^\d{4}$/.test(code)) return null;
  const map = await enrichStockFundamentals([code], options);
  return map.get(code) ?? null;
}
