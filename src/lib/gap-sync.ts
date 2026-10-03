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

/**
 * 證交所休市日（週末以外）。缺了會把同步目標卡在無報價日，
 * 導致 latestQuote >= target 永遠不成立、每次同步都深度回補。
 * 來源：TWSE holidaySchedule（至少涵蓋 2025–2027）。
 */
export const TWSE_HOLIDAYS: ReadonlySet<string> = new Set([
  // 2025
  "20250101",
  "20250127",
  "20250128",
  "20250129",
  "20250130",
  "20250131",
  "20250228",
  "20250403",
  "20250404",
  "20250501",
  "20250530",
  "20250531",
  "20251006",
  "20251010",
  // 2026
  "20260101",
  "20260216",
  "20260217",
  "20260218",
  "20260219",
  "20260220",
  "20260227",
  "20260403",
  "20260406",
  "20260501",
  "20260619",
  "20260925", // 中秋
  "20260928", // 教師節
  "20261009",
  "20261010",
  "20261026",
  "20261225",
  // 2027（常見國定假日；若 TWSE 另有補班／補假再補）
  "20270101",
  "20270205",
  "20270206",
  "20270207",
  "20270208",
  "20270209",
  "20270210",
  "20270211",
  "20270227",
  "20270228",
  "20270404",
  "20270405",
  "20270501",
  "20270609",
  "20270915",
  "20270928",
  "20271010",
  "20271011",
  "20271025",
  "20271225",
]);

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

export function isTwseHolidayYmd(ymd: string): boolean {
  return TWSE_HOLIDAYS.has(ymd);
}

/** 週末或證交所休市 → 非交易日 */
export function isNonTradingYmd(ymd: string): boolean {
  return isWeekendYmd(ymd) || isTwseHolidayYmd(ymd);
}

function prevCalendarDay(ymd: string): string {
  const d = parseYmd(ymd);
  d.setUTCDate(d.getUTCDate() - 1);
  return formatYmdUTC(d);
}

/** 往回走到最近一個「可能有報價」的交易日（跳過週末＋休市） */
export function prevTradingDayYmd(ymd: string): string {
  let cursor = prevCalendarDay(ymd);
  let guard = 0;
  while (isNonTradingYmd(cursor) && guard < 40) {
    cursor = prevCalendarDay(cursor);
    guard++;
  }
  return cursor;
}

/**
 * 同步目標交易日：
 * - 週末／休市 → 上一個交易日
 * - 交易日 18:00 前 → 上一個已收盤交易日（今天未定稿）
 * - 交易日 18:00 後 → 今天
 */
export function resolveSyncTargetYmd(now = new Date()): string {
  const clock = readTaipeiClock(now);
  let ymd = clock.ymd;
  // 今天本身休市／週末：直接回上一個交易日
  if (isNonTradingYmd(ymd)) {
    return prevTradingDayYmd(ymd);
  }
  // 交易日 18:00 前：今天尚未定稿
  if (clock.mins < 18 * 60) {
    ymd = prevTradingDayYmd(ymd);
  }
  return ymd;
}

/**
 * 從 afterYmd（不含）往後到 untilYmd（含）之間的交易日清單（由新到舊）。
 * 跳過週末與證交所休市。afterYmd 為 null 時不設下限。
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
    if (!isNonTradingYmd(cursor)) out.push(cursor);
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
  /** 產業流（全成分 EOD）；舊 meta 缺欄視為未齊 */
  industryFlow?: boolean;
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
      artifacts.valuePicks &&
      artifacts.industryFlow,
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

/**
 * 激進短路：日終 meta 的 asOf 已等於同步目標交易日。
 * （不強制 artifacts 全綠——有 active flow 即可略過交易所）
 */
export function isMetaAsOfTarget(
  meta: PackageMetaLike | null | undefined,
  targetYmd: string,
): boolean {
  if (!meta?.asOf || !targetYmd) return false;
  return toCompactYmd(meta.asOf) === targetYmd;
}

export type GapFillProgress = {
  done: number;
  need: number;
  skipped: number;
  fetched: number;
  missingTotal: number;
  currentYmd?: string;
  /** fetch=水位後缺日；depth=歷史深度回補；scan/done=檢查／完成 */
  phase: "scan" | "fetch" | "depth" | "done";
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
