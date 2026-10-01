/**
 * 美股增量同步：水位＋缺日判斷（America/New_York）。
 * 與台股 gap-sync 分離，避免假日／時區互相污染。
 */

import { toCompactYmd } from "@/lib/gap-sync";

export type NyClock = {
  ymd: string;
  hour: number;
  minute: number;
  mins: number;
  isWeekday: boolean;
};

/**
 * NYSE／Nasdaq 休市日（週末以外）。
 * 缺了會把同步目標卡在無報價日，導致每次同步都全量重抓。
 */
export const US_MARKET_HOLIDAYS: ReadonlySet<string> = new Set([
  // 2025
  "20250101", // New Year
  "20250120", // MLK
  "20250217", // Presidents
  "20250418", // Good Friday
  "20250526", // Memorial
  "20250619", // Juneteenth
  "20250704", // Independence
  "20250901", // Labor
  "20251127", // Thanksgiving
  "20251225", // Christmas
  // 2026
  "20260101",
  "20260119",
  "20260216",
  "20260403", // Good Friday
  "20260525",
  "20260619",
  "20260703", // Independence observed
  "20260907",
  "20261126",
  "20261225",
  // 2027
  "20270101",
  "20270118",
  "20270215",
  "20270326", // Good Friday
  "20270531",
  "20270618", // Juneteenth observed
  "20270705", // Independence observed
  "20270906",
  "20271125",
  "20271224", // Christmas observed
]);

export function readNyClock(now = new Date()): NyClock {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const parts = fmt.formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const weekday = get("weekday");
  const ymd = `${get("year")}${get("month")}${get("day")}`;
  const isWeekday = !["Sat", "Sun"].includes(weekday);
  return { ymd, hour, minute, mins: hour * 60 + minute, isWeekday };
}

function parseYmd(ymd: string): Date {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6));
  const d = Number(ymd.slice(6, 8));
  return new Date(Date.UTC(y, m - 1, d, 4, 0, 0));
}

function formatYmdUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function isWeekendYmd(ymd: string): boolean {
  const dow = parseYmd(ymd).getUTCDay();
  return dow === 0 || dow === 6;
}

export function isUsMarketHolidayYmd(ymd: string): boolean {
  return US_MARKET_HOLIDAYS.has(ymd);
}

export function isUsNonTradingYmd(ymd: string): boolean {
  return isWeekendYmd(ymd) || isUsMarketHolidayYmd(ymd);
}

function prevCalendarDay(ymd: string): string {
  const d = parseYmd(ymd);
  d.setUTCDate(d.getUTCDate() - 1);
  return formatYmdUTC(d);
}

/** 往回走到最近一個美股交易日（跳過週末＋NYSE 休市） */
export function prevUsTradingDayYmd(ymd: string): string {
  let cursor = prevCalendarDay(ymd);
  let guard = 0;
  while (isUsNonTradingYmd(cursor) && guard < 40) {
    cursor = prevCalendarDay(cursor);
    guard++;
  }
  return cursor;
}

/**
 * 美股同步目標交易日（America/New_York）：
 * - 週末／休市 → 上一個交易日
 * - 交易日 18:00 ET 前 → 上一個已收盤交易日
 * - 交易日 18:00 ET 後 → 今天
 */
export function resolveUsSyncTargetYmd(now = new Date()): string {
  const clock = readNyClock(now);
  let ymd = clock.ymd;
  if (isUsNonTradingYmd(ymd)) {
    return prevUsTradingDayYmd(ymd);
  }
  if (clock.mins < 18 * 60) {
    ymd = prevUsTradingDayYmd(ymd);
  }
  return ymd;
}

/** 美股日終 artifacts（與 UsDailyCloseMeta.artifacts 對齊） */
export type UsPackageArtifacts = {
  quotes: boolean;
  flow: boolean;
  stocks: boolean;
  klines: boolean;
  wind: boolean;
  ma: boolean;
  turnover: boolean;
  valuePicks: boolean;
};

export function usArtifactsComplete(
  artifacts: UsPackageArtifacts | null | undefined,
): boolean {
  if (!artifacts) return false;
  // klines／ma 可有意略過並標 true；核心讀頁 artifacts 必須齊
  return Boolean(
    artifacts.quotes &&
      artifacts.flow &&
      artifacts.stocks &&
      artifacts.wind &&
      artifacts.turnover &&
      artifacts.valuePicks,
  );
}

export type UsPackageMetaLike = {
  asOf: string | null;
  artifacts: UsPackageArtifacts;
};

export function isUsPackageUpToDate(
  meta: UsPackageMetaLike | null | undefined,
  latestQuoteYmd: string | null,
): boolean {
  if (!meta?.asOf || !latestQuoteYmd) return false;
  if (toCompactYmd(meta.asOf) !== latestQuoteYmd) return false;
  return usArtifactsComplete(meta.artifacts);
}

export function isUsMetaAsOfTarget(
  meta: UsPackageMetaLike | null | undefined,
  targetYmd: string,
): boolean {
  if (!meta?.asOf || !targetYmd) return false;
  return toCompactYmd(meta.asOf) === targetYmd;
}

export { toCompactYmd };
