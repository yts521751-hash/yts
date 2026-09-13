/** 瀏覽器端安全讀 JSON：若伺服器回 HTML（冷啟動／逾時／502）給可讀錯誤 */
export async function readResponseJson<T = unknown>(
  res: Response,
  fallbackError = "伺服器回應異常",
): Promise<T> {
  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(
      res.ok ? "伺服器回傳空白" : `${fallbackError}（HTTP ${res.status}）`,
    );
  }
  if (trimmed.startsWith("<") || trimmed.startsWith("<!")) {
    throw new Error(
      res.status >= 500
        ? `伺服器忙碌或冷啟動中（HTTP ${res.status}），請稍後再按一次同步`
        : `API 回傳了網頁而非資料（HTTP ${res.status}），請重新整理後再試`,
    );
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(
      `${fallbackError}：無法解析資料（HTTP ${res.status}）`,
    );
  }
}
