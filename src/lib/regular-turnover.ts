/**
 * 一般成交金額（對齊 Yahoo／媒體常見口徑）：
 * 證交所 MI_INDEX 總成交 − 盤後定價 − 盤中／盤後零股 − 鉅額。
 *
 * 說明：證交所日結「成交金額」含一般＋零股＋盤後定價＋鉅額；
 * Yahoo 股市標註「成交金額不含盤後定價、零股、鉅額、拍賣及標購」。
 */

import {
  fetchJson,
  parseNumber,
  readCacheFile,
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
    const code = String(row[codeIdx] ?? "").trim();
    if (!/^\d{4}/.test(code)) continue;
    const amt = parseNumber(row[amtIdx]);
    if (amt <= 0) continue;
    out.set(code, (out.get(code) ?? 0) + amt);
  }
  return out;
}

/** 抓取證交所當日應排除金額（盤後定價＋零股＋鉅額） */
export async function loadTwseTurnoverExclusions(
  ymd: string,
  options?: { force?: boolean },
): Promise<Map<string, number>> {
  if (!options?.force) {
    const cached = await readCacheFile<ExclusionCache>(exclusionCacheName(ymd));
    if (cached?.byCode && cached.ymd === ymd) {
      return new Map(Object.entries(cached.byCode));
    }
  }

  const afterHours = await sumTwseTable(
    `https://www.twse.com.tw/exchangeReport/BFT41U?response=json&date=${ymd}&selectType=ALL`,
    0,
    4,
  );
  const oddAfter = await sumTwseTable(
    `https://www.twse.com.tw/exchangeReport/TWT53U?response=json&date=${ymd}`,
    0,
    4,
  );
  const oddDay = await sumTwseTable(
    `https://www.twse.com.tw/exchangeReport/TWTC7U?response=json&date=${ymd}`,
    0,
    4,
  );

  // 鉅額：多筆；成交金額在欄位 5
  const blockPayload = await fetchJson<{
    stat?: string;
    data?: string[][];
  }>(
    `https://www.twse.com.tw/rwd/zh/block/BFIAUU?date=${ymd}&selectType=S&response=json`,
  );
  const block = new Map<string, number>();
  for (const row of blockPayload?.data ?? []) {
    const code = String(row[0] ?? "").trim();
    if (!/^\d{4}/.test(code)) continue;
    const amt = parseNumber(row[5]);
    if (amt <= 0) continue;
    block.set(code, (block.get(code) ?? 0) + amt);
  }

  const byCode = new Map<string, number>();
  const add = (m: Map<string, number>) => {
    for (const [code, amt] of m) {
      byCode.set(code, (byCode.get(code) ?? 0) + amt);
    }
  };
  add(afterHours);
  add(oddAfter);
  add(oddDay);
  add(block);

  if (byCode.size) {
    const payload: ExclusionCache = {
      ymd,
      builtAt: new Date().toISOString(),
      byCode: Object.fromEntries(byCode),
    };
    await writeCacheFile(exclusionCacheName(ymd), payload);
  }
  return byCode;
}

/**
 * 將報價 map 的成交金額改為「一般成交」口徑（上市適用；上櫃維持原值）。
 * 不會改到小於 0。
 */
export async function applyRegularTurnover(
  quotes: Map<string, { code: string; turnover: number }>,
  ymd: string,
  options?: { force?: boolean },
): Promise<Map<string, number>> {
  const excl = await loadTwseTurnoverExclusions(ymd, options);
  const regular = new Map<string, number>();
  for (const q of quotes.values()) {
    const cut = excl.get(q.code) ?? 0;
    regular.set(q.code, Math.max(0, q.turnover - cut));
  }
  return regular;
}
