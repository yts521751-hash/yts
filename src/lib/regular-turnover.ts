/**
 * 一般成交金額（對齊 Yahoo／媒體常見口徑）：
 * 總成交 − 盤後定價 − 盤中／盤後零股 − 鉅額（上市＋上櫃）。
 */

import {
  fetchJson,
  fetchJsonViaCurl,
  parseNumber,
  readCacheFile,
  toSlashDate,
  writeCacheFile,
} from "@/lib/tw-market";

type ExclusionCache = {
  ymd: string;
  builtAt: string;
  /** 各代號應自總成交扣除的金額（元） */
  byCode: Record<string, number>;
};

function exclusionCacheName(ymd: string) {
  return `turnover-exclude-${ymd}.json`;
}

/** YYYYMMDD → 民國年日期字串，如 1150924 */
function toRocYmd(ymd: string): string {
  const y = Number(ymd.slice(0, 4)) - 1911;
  return `${y}${ymd.slice(4)}`;
}

function addAmt(map: Map<string, number>, code: string, amt: number) {
  if (!/^\d{4}/.test(code) || !(amt > 0)) return;
  map.set(code, (map.get(code) ?? 0) + amt);
}

async function sumTwseTable(
  url: string,
  codeIdx: number,
  amtIdx: number,
): Promise<Map<string, number>> {
  const payload = await fetchJson<{
    stat?: string;
    fields?: string[];
    data?: string[][];
  }>(url);
  const out = new Map<string, number>();
  if (!payload || payload.stat !== "OK" || !payload.data?.length) return out;
  for (const row of payload.data) {
    addAmt(out, String(row[codeIdx] ?? "").trim(), parseNumber(row[amtIdx]));
  }
  return out;
}

async function loadTwseExclusions(ymd: string): Promise<Map<string, number>> {
  // 四支排除額報表彼此獨立，並行抓取以縮短日終／補缺延遲
  const [afterHours, oddAfter, oddDay, blockPayload] = await Promise.all([
    sumTwseTable(
      `https://www.twse.com.tw/exchangeReport/BFT41U?response=json&date=${ymd}&selectType=ALL`,
      0,
      4,
    ),
    sumTwseTable(
      `https://www.twse.com.tw/exchangeReport/TWT53U?response=json&date=${ymd}`,
      0,
      4,
    ),
    sumTwseTable(
      `https://www.twse.com.tw/exchangeReport/TWTC7U?response=json&date=${ymd}`,
      0,
      4,
    ),
    fetchJson<{
      stat?: string;
      data?: string[][];
    }>(
      `https://www.twse.com.tw/rwd/zh/block/BFIAUU?date=${ymd}&selectType=S&response=json`,
    ),
  ]);
  const block = new Map<string, number>();
  for (const row of blockPayload?.data ?? []) {
    addAmt(block, String(row[0] ?? "").trim(), parseNumber(row[5]));
  }

  const byCode = new Map<string, number>();
  for (const m of [afterHours, oddAfter, oddDay, block]) {
    for (const [code, amt] of m) addAmt(byCode, code, amt);
  }
  return byCode;
}

async function loadTpexExclusions(ymd: string): Promise<Map<string, number>> {
  const byCode = new Map<string, number>();
  const roc = toRocYmd(ymd);
  const slash = toSlashDate(ymd);

  // 盤中零股（可指定日期）
  const oddDay =
    (await fetchJsonViaCurl<{
      stat?: string;
      tables?: { fields?: string[]; data?: string[][] }[];
    }>(
      `https://www.tpex.org.tw/www/zh-tw/afterTrading/oddQuote?date=${slash}&id=&response=json`,
    )) ??
    (await fetchJson<{
      stat?: string;
      tables?: { fields?: string[]; data?: string[][] }[];
    }>(
      `https://www.tpex.org.tw/www/zh-tw/afterTrading/oddQuote?date=${slash}&id=&response=json`,
    ));
  const oddTable = oddDay?.tables?.[0];
  if (oddTable?.data?.length) {
    const fields = (oddTable.fields ?? []).map((f) =>
      f.replace(/<[^>]+>/g, "").trim(),
    );
    const iCode = fields.findIndex((f) => f.includes("代號"));
    const iAmt = fields.findIndex((f) => f.includes("成交金額"));
    for (const row of oddTable.data) {
      addAmt(
        byCode,
        String(row[Math.max(iCode, 0)] ?? "").trim(),
        parseNumber(row[Math.max(iAmt, 8)]),
      );
    }
  }

  // 盤後零股（OpenAPI；僅當日檔）
  const oddAfter =
    (await fetchJsonViaCurl<
      Array<{
        Date?: string;
        SecuritiesCompanyCode?: string;
        TradeAmount?: string;
      }>
    >("https://www.tpex.org.tw/openapi/v1/tpex_odd_stock")) ??
    (await fetchJson<
      Array<{
        Date?: string;
        SecuritiesCompanyCode?: string;
        TradeAmount?: string;
      }>
    >("https://www.tpex.org.tw/openapi/v1/tpex_odd_stock"));
  for (const row of oddAfter ?? []) {
    if (String(row.Date ?? "") !== roc) continue;
    addAmt(
      byCode,
      String(row.SecuritiesCompanyCode ?? "").trim(),
      parseNumber(row.TradeAmount),
    );
  }

  // 盤後定價
  const off =
    (await fetchJsonViaCurl<
      Array<{
        Date?: string;
        SecuritiesCompanyCode?: string;
        TradeAmount?: string;
      }>
    >("https://www.tpex.org.tw/openapi/v1/tpex_off_market")) ??
    (await fetchJson<
      Array<{
        Date?: string;
        SecuritiesCompanyCode?: string;
        TradeAmount?: string;
      }>
    >("https://www.tpex.org.tw/openapi/v1/tpex_off_market"));
  for (const row of off ?? []) {
    if (String(row.Date ?? "") !== roc) continue;
    addAmt(
      byCode,
      String(row.SecuritiesCompanyCode ?? "").trim(),
      parseNumber(row.TradeAmount),
    );
  }

  // 鉅額
  const block =
    (await fetchJsonViaCurl<
      Array<{ Date?: string; Code?: string; TradeValue?: string }>
    >("https://www.tpex.org.tw/openapi/v1/tpex_daily_qutoes_block")) ??
    (await fetchJson<
      Array<{ Date?: string; Code?: string; TradeValue?: string }>
    >("https://www.tpex.org.tw/openapi/v1/tpex_daily_qutoes_block"));
  for (const row of block ?? []) {
    if (String(row.Date ?? "") !== roc) continue;
    addAmt(byCode, String(row.Code ?? "").trim(), parseNumber(row.TradeValue));
  }

  return byCode;
}

/** 抓取上市＋上櫃當日應排除金額 */
export async function loadTurnoverExclusions(
  ymd: string,
  options?: { force?: boolean },
): Promise<Map<string, number>> {
  if (!options?.force) {
    const cached = await readCacheFile<ExclusionCache>(exclusionCacheName(ymd));
    if (cached?.byCode && cached.ymd === ymd) {
      return new Map(Object.entries(cached.byCode));
    }
  }

  const [twse, tpex] = await Promise.all([
    loadTwseExclusions(ymd),
    loadTpexExclusions(ymd),
  ]);
  const byCode = new Map<string, number>(twse);
  for (const [code, amt] of tpex) addAmt(byCode, code, amt);

  if (byCode.size) {
    await writeCacheFile(exclusionCacheName(ymd), {
      ymd,
      builtAt: new Date().toISOString(),
      byCode: Object.fromEntries(byCode),
    } satisfies ExclusionCache);
  }
  return byCode;
}

/** @deprecated 使用 loadTurnoverExclusions */
export const loadTwseTurnoverExclusions = loadTurnoverExclusions;

/** 是否已有當日排除額快取（不打交易所） */
export async function hasTurnoverExclusionsCache(ymd: string): Promise<boolean> {
  const cached = await readCacheFile<ExclusionCache>(exclusionCacheName(ymd));
  return Boolean(cached?.byCode && cached.ymd === ymd);
}

/**
 * 並行暖機多日排除額（寫入 turnover-exclude-*.json）。
 * 個股金流重建前呼叫，避免逐日串行打 TWSE／TPEx。
 */
export async function warmTurnoverExclusions(
  ymds: string[],
  options?: { forceLatest?: string; concurrency?: number },
): Promise<{ warmed: number; skipped: number }> {
  const concurrency = Math.max(1, options?.forceLatest ? 4 : options?.concurrency ?? 4);
  const unique = [...new Set(ymds.filter(Boolean))];
  let warmed = 0;
  let skipped = 0;
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, unique.length)) }, async () => {
      while (i < unique.length) {
        const idx = i++;
        const ymd = unique[idx];
        const force = options?.forceLatest === ymd;
        if (!force && (await hasTurnoverExclusionsCache(ymd))) {
          skipped += 1;
          continue;
        }
        try {
          const map = await loadTurnoverExclusions(ymd, { force });
          if (map.size) warmed += 1;
          else skipped += 1;
        } catch (err) {
          console.warn(`[regular-turnover] warm ${ymd} failed`, err);
          skipped += 1;
        }
      }
    }),
  );
  return { warmed, skipped };
}

/**
 * 將報價 map 的成交金額改為「一般成交」口徑。
 * 不會改到小於 0。
 * `skipNetwork`：無排除快取時直接用總成交（SSR／頁面不應卡交易所）。
 */
export async function applyRegularTurnover(
  quotes: Map<string, { code: string; turnover: number }>,
  ymd: string,
  options?: { force?: boolean; skipNetwork?: boolean },
): Promise<Map<string, number>> {
  let excl: Map<string, number>;
  if (options?.skipNetwork && !options?.force) {
    if (await hasTurnoverExclusionsCache(ymd)) {
      excl = await loadTurnoverExclusions(ymd);
    } else {
      excl = new Map();
    }
  } else {
    excl = await loadTurnoverExclusions(ymd, options);
  }
  const regular = new Map<string, number>();
  for (const q of quotes.values()) {
    const cut = excl.get(q.code) ?? 0;
    regular.set(q.code, Math.max(0, q.turnover - cut));
  }
  return regular;
}
