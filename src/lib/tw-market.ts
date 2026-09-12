import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

const UA =
  "Mozilla/5.0 (compatible; JinChao/1.0; +https://localhost; research)";

export type InstiRow = {
  code: string;
  name: string;
  foreign: number;
  trust: number;
  dealer: number;
  total: number;
};

export type QuoteRow = {
  code: string;
  name: string;
  close: number;
  changePct: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export function toRocSlash(ymd: string): string {
  return `${Number(ymd.slice(0, 4)) - 1911}/${ymd.slice(4, 6)}/${ymd.slice(6, 8)}`;
}

export function parseNumber(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  if (typeof raw !== "string") return 0;
  const cleaned = raw.replace(/,/g, "").replace(/\+/g, "").trim();
  if (!cleaned || cleaned === "--" || cleaned === "---") return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export async function fetchJson<T>(url: string, retries = 2): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json,text/plain,*/*" },
        cache: "no-store",
      });
      if (!res.ok) {
        if (attempt === retries) return null;
        await sleep(400 * (attempt + 1));
        continue;
      }
      return (await res.json()) as T;
    } catch {
      if (attempt === retries) return null;
      await sleep(500 * (attempt + 1));
    }
  }
  return null;
}

export async function fetchJsonViaCurl<T>(url: string): Promise<T | null> {
  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const run = promisify(execFile);
    const { stdout } = await run(
      "curl",
      ["-sS", "-k", "-A", UA, "--max-time", "90", url],
      { maxBuffer: 30 * 1024 * 1024 },
    );
    if (!stdout?.trim()) return null;
    return JSON.parse(stdout) as T;
  } catch {
    return null;
  }
}

type TwseTable = {
  stat?: string;
  fields?: string[];
  data?: string[][];
  tables?: { title?: string; fields?: string[]; data?: string[][] }[];
};

type TpexTable = {
  tables?: { fields?: string[]; data?: string[][] }[];
};

type TpexQuoteApi = {
  Date?: string;
  SecuritiesCompanyCode?: string;
  CompanyName?: string;
  Close?: string;
  Change?: string;
};

export async function fetchTwseT86(ymd: string): Promise<InstiRow[] | null> {
  const url = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${ymd}&selectType=ALL&response=json`;
  const payload = await fetchJson<TwseTable>(url);
  if (!payload || payload.stat !== "OK" || !payload.data?.length) return null;

  const fields = payload.fields ?? [];
  const idx = (pred: (f: string) => boolean) => fields.findIndex(pred);
  const iCode = idx((f) => f.includes("證券代號"));
  const iName = idx((f) => f.includes("證券名稱"));
  const iForeign = idx((f) => f.includes("外陸資買賣超股數(不含"));
  const iForeignDealer = idx((f) => f.includes("外資自營商買賣超"));
  const iTrust = idx((f) => f === "投信買賣超股數");
  const iDealer = idx((f) => f === "自營商買賣超股數");
  const iTotal = idx((f) => f.includes("三大法人買賣超"));

  return payload.data.map((row) => {
    const foreign =
      parseNumber(row[iForeign]) +
      (iForeignDealer >= 0 ? parseNumber(row[iForeignDealer]) : 0);
    const trust = iTrust >= 0 ? parseNumber(row[iTrust]) : 0;
    const dealer = iDealer >= 0 ? parseNumber(row[iDealer]) : 0;
    const total =
      iTotal >= 0 ? parseNumber(row[iTotal]) : foreign + trust + dealer;
    return {
      code: String(row[Math.max(iCode, 0)] ?? "").trim(),
      name: String(row[Math.max(iName, 1)] ?? "").trim(),
      foreign,
      trust,
      dealer,
      total,
    };
  });
}

export async function fetchTpexInsti(ymd: string): Promise<InstiRow[] | null> {
  const d = toRocSlash(ymd);
  const url = `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&o=json&se=EW&t=D&d=${encodeURIComponent(d)}&s=0,asc`;
  const payload =
    (await fetchJsonViaCurl<TpexTable>(url)) ?? (await fetchJson<TpexTable>(url));
  const table = payload?.tables?.[0];
  if (!table?.data?.length) return null;

  return table.data.map((row) => ({
    code: String(row[0] ?? "").trim(),
    name: String(row[1] ?? "").trim(),
    foreign: parseNumber(row[10]),
    trust: parseNumber(row[13]),
    dealer: parseNumber(row[22]),
    total: parseNumber(row[23]),
  }));
}

export async function fetchTwseQuotes(ymd: string): Promise<{
  quotes: QuoteRow[];
  indexChangePct: number | null;
} | null> {
  const url = `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${ymd}&type=ALLBUT0999&response=json`;
  const payload = await fetchJson<TwseTable>(url);
  if (!payload || payload.stat !== "OK" || !payload.tables?.length) return null;

  let indexChangePct: number | null = null;
  for (const row of payload.tables[0]?.data ?? []) {
    if (String(row[0]).includes("發行量加權股價指數")) {
      indexChangePct = parseNumber(row[4]);
      break;
    }
  }

  const quoteTable = payload.tables.find((t) =>
    (t.title ?? "").includes("每日收盤行情"),
  );
  if (!quoteTable?.data?.length) return { quotes: [], indexChangePct };

  const fields = quoteTable.fields ?? [];
  const iCode = fields.findIndex((f) => f.includes("證券代號"));
  const iName = fields.findIndex((f) => f.includes("證券名稱"));
  const iClose = fields.findIndex((f) => f === "收盤價");
  const iSign = fields.findIndex((f) => f.includes("漲跌(+/-)"));
  const iDiff = fields.findIndex((f) => f.includes("漲跌價差"));

  const quotes: QuoteRow[] = [];
  for (const row of quoteTable.data) {
    const code = String(row[iCode] ?? "").trim();
    if (!/^\d{4}/.test(code)) continue;
    const close = parseNumber(row[iClose]);
    if (close <= 0) continue;
    const signHtml = String(row[iSign] ?? "");
    const sign =
      signHtml.includes("red") || signHtml.includes("+")
        ? 1
        : signHtml.includes("green") || signHtml.includes("-")
          ? -1
          : 0;
    const diff = parseNumber(row[iDiff]) * sign;
    const prev = close - diff;
    quotes.push({
      code,
      name: String(row[iName] ?? "").trim(),
      close,
      changePct: prev > 0 ? (diff / prev) * 100 : 0,
    });
  }
  return { quotes, indexChangePct };
}

export async function fetchTpexQuotes(ymd: string): Promise<{
  quotes: QuoteRow[];
} | null> {
  const url =
    "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes";
  const payload =
    (await fetchJsonViaCurl<TpexQuoteApi[]>(url)) ??
    (await fetchJson<TpexQuoteApi[]>(url));
  if (!Array.isArray(payload) || !payload.length) return null;

  const want = `${Number(ymd.slice(0, 4)) - 1911}${ymd.slice(4)}`;
  const filtered = payload.filter((r) => !r.Date || r.Date === want);
  const rows = filtered.length ? filtered : payload;

  return {
    quotes: rows
      .map((r) => {
        const close = parseNumber(r.Close);
        const change = parseNumber(r.Change);
        const prev = close - change;
        return {
          code: String(r.SecuritiesCompanyCode ?? "").trim(),
          name: String(r.CompanyName ?? "").trim(),
          close,
          changePct: prev > 0 ? (change / prev) * 100 : 0,
        };
      })
      .filter((q) => q.code && q.close > 0),
  };
}

export async function listRecentTradingDays(
  need: number,
  lookbackCalendar = 50,
): Promise<string[]> {
  const days: string[] = [];
  const cursor = new Date();
  cursor.setHours(12, 0, 0, 0);

  for (let i = 0; i < lookbackCalendar && days.length < need; i++) {
    const ymd = toYmd(cursor);
    const rows = await fetchTwseT86(ymd);
    if (rows && rows.length > 0) days.push(ymd);
    cursor.setDate(cursor.getDate() - 1);
    await sleep(260);
  }
  return days;
}

const CACHE_DIR = path.join(process.cwd(), ".cache");

export async function readCacheFile<T>(name: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path.join(CACHE_DIR, name), "utf8")) as T;
  } catch {
    return null;
  }
}

export async function writeCacheFile(name: string, data: unknown) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(path.join(CACHE_DIR, name), JSON.stringify(data), "utf8");
}
