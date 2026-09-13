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
  flow: "jinliu:cache:flow:v2",
  stocks: "jinliu:cache:stocks:v2",
  wind: "jinliu:cache:wind:v2",
  turnover: "jinliu:cache:turnover:v2",
} as const;
