import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

const UA =
  "Mozilla/5.0 (compatible; JinChao/1.0; +https://localhost; research)";

export type QuoteRow = {
  code: string;
  name: string;
  close: number;
  changePct: number;
  /** 成交金額（元） */
  turnover: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export function toSlashDate(ymd: string): string {
  return `${ymd.slice(0, 4)}/${ymd.slice(4, 6)}/${ymd.slice(6, 8)}`;
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
        headers: {
          "User-Agent": UA,
          Accept: "application/json,text/plain,*/*",
        },
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
      [
        "-sS",
        "-k",
        "--http1.1",
        "--compressed",
        "-A",
        "Mozilla/5.0",
        "--max-time",
        "90",
        url,
      ],
      { maxBuffer: 40 * 1024 * 1024 },
    );
    if (!stdout?.trim()) return null;
    return JSON.parse(stdout) as T;
  } catch {
    return null;
  }
}

type TwseTable = {
  stat?: string;
  tables?: { title?: string; fields?: string[]; data?: string[][] }[];
};

type TpexDailyQuotes = {
  tables?: { title?: string; fields?: string[]; data?: string[][] }[];
};

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
  const iTurnover = fields.findIndex((f) => f.includes("成交金額"));
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
      turnover: iTurnover >= 0 ? parseNumber(row[iTurnover]) : 0,
    });
  }
  return { quotes, indexChangePct };
}

export async function fetchTpexQuotes(ymd: string): Promise<{
  quotes: QuoteRow[];
} | null> {
  const url = `https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=${toSlashDate(ymd)}&id=&response=json`;
  const payload =
    (await fetchJsonViaCurl<TpexDailyQuotes>(url)) ??
    (await fetchJson<TpexDailyQuotes>(url));
  const table = payload?.tables?.[0];
  if (!table?.data?.length) return null;

  const fields = (table.fields ?? []).map((f) =>
    f.replace(/<[^>]+>/g, "").trim(),
  );
  const iCode = fields.findIndex((f) => f.includes("代號"));
  const iName = fields.findIndex((f) => f.includes("名稱"));
  const iClose = fields.findIndex((f) => f.includes("收盤"));
  const iChange = fields.findIndex((f) => f.includes("漲跌"));
  const iAmt = fields.findIndex((f) => f.includes("成交金額"));

  const quotes: QuoteRow[] = [];
  for (const row of table.data) {
    const code = String(row[Math.max(iCode, 0)] ?? "").trim();
    if (!/^\d{4}/.test(code)) continue;
    const close = parseNumber(row[iClose]);
    if (close <= 0) continue;
    const change = parseNumber(row[iChange]);
    const prev = close - change;
    quotes.push({
      code,
      name: String(row[Math.max(iName, 1)] ?? "").trim(),
      close,
      changePct: prev > 0 ? (change / prev) * 100 : 0,
      turnover: iAmt >= 0 ? parseNumber(row[iAmt]) : 0,
    });
  }
  return { quotes };
}

/** 以證交所每日收盤行情判斷交易日（不再依賴法人買賣超） */
export async function listRecentTradingDays(
  need: number,
  lookbackCalendar = 50,
): Promise<string[]> {
  const days: string[] = [];
  const cursor = new Date();
  cursor.setHours(12, 0, 0, 0);

  for (let i = 0; i < lookbackCalendar && days.length < need; i++) {
    const ymd = toYmd(cursor);
    const bundle = await fetchTwseQuotes(ymd);
    if (bundle && bundle.quotes.length > 0) days.push(ymd);
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
