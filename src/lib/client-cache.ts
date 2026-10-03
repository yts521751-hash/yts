/**
 * 瀏覽器端 stale-while-revalidate：先畫上次快取，再背景拉新資料。
 * 僅存於本機，不取代伺服器 active／staging 灰度。
 */

type Envelope<T> = {
  savedAt: number;
  data: T;
};

export function readClientCache<T>(
  key: string,
  maxAgeMs = 1000 * 60 * 60 * 12,
): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Envelope<T>;
    if (!parsed?.data || typeof parsed.savedAt !== "number") return null;
    if (Date.now() - parsed.savedAt > maxAgeMs) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function writeClientCache<T>(key: string, data: T) {
  if (typeof window === "undefined") return;
  try {
    const envelope: Envelope<T> = { savedAt: Date.now(), data };
    window.localStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    /* quota / private mode */
  }
}

export const CLIENT_CACHE_KEYS = {
  /** v2：略過可能不完整的舊本機快取 */
  flow: "jinliu:cache:flow:v3",
  /** v4：個股成交額改一般成交口徑（與成值頁對齊） */
  stocks: "jinliu:cache:stocks:v4",
  wind: "jinliu:cache:wind:v2",
  /** v4：一般成交口徑（扣零股／鉅額／盤後定價）＋日終快照 */
  turnover: "jinliu:cache:turnover:v4",
  ma: "jinliu:cache:ma-screener:v5",
  /** v4：含本益成長比 PEG；對齊最新 quotes 日 close／PE */
  value: "jinliu:cache:value-picks:v4",
  /** v3：聯發科新增 ASIC／矽智財跨標籤，不能沿用舊成分聚合 */
  industryFlow: "jinliu:cache:industry-flow:v3",
} as const;
