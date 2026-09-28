/**
 * 增量同步：水位（最新完整交易日）＋缺日補齊。
 * 純函式可單測；I/O 包裝在 turnover.fillTradingDayGaps。
 */

/** YYYY-MM-DD 或已是 YYYYMMDD → YYYYMMDD */
export function toCompactYmd(dateLike: string): string {
  return dateLike.replace(/-/g, "").slice(0, 8);
}

export type TaipeiClock = {
  ymd: string;
  hour: number;
  minute: number;
  mins: number;
  isWeekday: boolean;
};

/** 以 Asia/Taipei 讀取目前時鐘（不依賴主機 TZ） */
export function readTaipeiClock(now = new Date()): TaipeiClock {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
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

function prevCalendarDay(ymd: string): string {
  const d = parseYmd(ymd);
  d.setUTCDate(d.getUTCDate() - 1);
  return formatYmdUTC(d);
}

/**
 * 同步目標交易日：
 * - 週末 → 上一個週五
 * - 平日 18:00 前 → 上一個已收盤交易日（今天未定稿）
 * - 平日 18:00 後 → 今天
 */
export function resolveSyncTargetYmd(now = new Date()): string {
  const clock = readTaipeiClock(now);
  let ymd = clock.ymd;
  if (clock.isWeekday && clock.mins < 18 * 60) {
    ymd = prevCalendarDay(ymd);
  }
  while (isWeekendYmd(ymd)) {
    ymd = prevCalendarDay(ymd);
  }
  return ymd;
}

/**
 * 從 afterYmd（不含）往後到 untilYmd（含）之間的平日清單（由新到舊）。
 * afterYmd 為 null 時不設下限，只受 maxDays／日曆回看限制。
 */
export function listWeekdaysBetween(
  afterYmd: string | null,
  untilYmd: string,
  maxDays = 80,
): string[] {
  const out: string[] = [];
  let cursor = untilYmd;
  let guard = 0;
  while (out.length < maxDays && guard < 400) {
    guard++;
    if (afterYmd && cursor <= afterYmd) break;
    if (!isWeekendYmd(cursor)) out.push(cursor);
    cursor = prevCalendarDay(cursor);
  }
  return out;
}

/** 在候選交易日中挑出本機／集合尚未有的缺日（保持候選順序） */
export function findMissingTradingDays(
  existing: Iterable<string>,
  candidates: string[],
): string[] {
  const have = existing instanceof Set ? existing : new Set(existing);
  return candidates.filter((ymd) => !have.has(ymd));
}

/** 日終大包 artifacts 是否齊（與 DailyCloseMeta.artifacts 對齊） */
export type PackageArtifacts = {
  flow: boolean;
  quotesWarm: boolean;
  klines: boolean;
  stocks: boolean;
  wind: boolean;
  ma: boolean;
  turnoverClose: boolean;
  valuePicks: boolean;
};

export function artifactsComplete(
  artifacts: PackageArtifacts | null | undefined,
): boolean {
  if (!artifacts) return false;
  return Boolean(
    artifacts.flow &&
      artifacts.quotesWarm &&
      artifacts.klines &&
      artifacts.stocks &&
      artifacts.wind &&
      artifacts.ma &&
      artifacts.turnoverClose &&
      artifacts.valuePicks,
  );
}

export type PackageMetaLike = {
  asOf: string | null;
  artifacts: PackageArtifacts;
};

/**
 * 日終大包是否已對齊「最新報價日」且 artifacts 齊全。
 * asOf 為 YYYY-MM-DD；latestQuoteYmd 為 YYYYMMDD。
 */
export function isPackageUpToDate(
  meta: PackageMetaLike | null | undefined,
  latestQuoteYmd: string | null,
): boolean {
  if (!meta?.asOf || !latestQuoteYmd) return false;
  if (toCompactYmd(meta.asOf) !== latestQuoteYmd) return false;
  return artifactsComplete(meta.artifacts);
}

export type GapFillProgress = {
  done: number;
  need: number;
  skipped: number;
  fetched: number;
  missingTotal: number;
  currentYmd?: string;
  phase: "scan" | "fetch" | "done";
};

export type GapFillResult = {
  watermark: string | null;
  target: string;
  missing: string[];
  fetched: number;
  skipped: number;
  quoteDays: string[];
  /** 有實際打交易所補檔 */
  didFetch: boolean;
};
