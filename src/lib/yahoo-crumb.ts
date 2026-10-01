/**
 * Yahoo Finance cookie + crumb（quoteSummary 等需授權的端點）。
 * 與 chart API 不同：無 crumb 會 401 Invalid Crumb。
 *
 * Render／雲端常見問題：cookie jar 不完整、crumb 過期、query host 差異。
 * 此實作：瀏覽器標頭、fc.yahoo.com 暖機、query1/query2 輪詢、失敗強制刷新。
 */

import { execFile } from "child_process";
import { promisify } from "util";

const run = promisify(execFile);

export type YahooCrumbAuth = { crumb: string; jar: string; at: number };

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const CURL_HEADERS = [
  "-H",
  "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "-H",
  "Accept-Language: en-US,en;q=0.9",
  "-H",
  "Connection: keep-alive",
];

let cached: YahooCrumbAuth | null = null;

function isValidCrumb(crumb: string): boolean {
  const c = crumb.trim();
  if (!c) return false;
  if (c.includes("<") || c.includes(" ") || c.includes("{")) return false;
  if (/invalid|unauthorized|error/i.test(c)) return false;
  // Yahoo crumb 通常短字串（含 URL-safe 字元）
  if (c.length < 8 || c.length > 128) return false;
  return true;
}

async function tryAcquireOnce(jar: string): Promise<string | null> {
  // 暖機：fc.yahoo.com 寫入 A1/A3 cookie（finance.yahoo.com 常拿不到）
  await run(
    "curl",
    [
      "-sS",
      "-c",
      jar,
      "-b",
      jar,
      "-A",
      UA,
      ...CURL_HEADERS,
      "-o",
      "/dev/null",
      "--max-time",
      "20",
      "https://fc.yahoo.com",
    ],
    { timeout: 25000 },
  );

  const crumbHosts = [
    "https://query1.finance.yahoo.com/v1/test/getcrumb",
    "https://query2.finance.yahoo.com/v1/test/getcrumb",
  ];
  for (const host of crumbHosts) {
    try {
      const { stdout } = await run(
        "curl",
        [
          "-sS",
          "-c",
          jar,
          "-b",
          jar,
          "-A",
          UA,
          ...CURL_HEADERS,
          "-H",
          "Accept: text/plain,*/*",
          "-H",
          "Referer: https://finance.yahoo.com/",
          "--max-time",
          "20",
          host,
        ],
        { timeout: 25000 },
      );
      const crumb = String(stdout || "").trim();
      if (isValidCrumb(crumb)) return crumb;
    } catch {
      /* try next host */
    }
  }
  return null;
}

export async function getYahooCrumbAuth(
  force = false,
): Promise<YahooCrumbAuth | null> {
  if (!force && cached && Date.now() - cached.at < 25 * 60 * 1000) {
    return cached;
  }
  const jar = `/tmp/yahoo-crumb-${process.pid}.txt`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        // 換新 jar，避免壞 cookie 卡住
        await run("rm", ["-f", jar], { timeout: 5000 }).catch(() => undefined);
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
      const crumb = await tryAcquireOnce(jar);
      if (crumb) {
        cached = { crumb, jar, at: Date.now() };
        return cached;
      }
    } catch {
      /* retry */
    }
  }
  cached = null;
  return null;
}

/** 丟棄快取（收到 Invalid Crumb／401 時呼叫） */
export function clearYahooCrumbAuth() {
  cached = null;
}

/** 帶 cookie／crumb 的 curl GET；401／Invalid Crumb 時自動刷 crumb 重試一次 */
export async function yahooAuthedGet(
  url: string,
  auth: YahooCrumbAuth,
): Promise<string | null> {
  const attempt = async (a: YahooCrumbAuth): Promise<{ body: string; badCrumb: boolean }> => {
    try {
      const sep = url.includes("?") ? "&" : "?";
      const full = `${url}${sep}crumb=${encodeURIComponent(a.crumb)}`;
      const { stdout } = await run(
        "curl",
        [
          "-sS",
          "-b",
          a.jar,
          "-c",
          a.jar,
          "-A",
          UA,
          "-H",
          "Accept: application/json",
          "-H",
          "Accept-Language: en-US,en;q=0.9",
          "-H",
          "Referer: https://finance.yahoo.com/",
          "--max-time",
          "20",
          full,
        ],
        { timeout: 25000, maxBuffer: 4 * 1024 * 1024 },
      );
      const body = String(stdout || "");
      const badCrumb =
        /Invalid Crumb|Invalid Cookie|"Unauthorized"/i.test(body) ||
        body.trim() === "";
      return { body, badCrumb };
    } catch {
      return { body: "", badCrumb: true };
    }
  };

  let { body, badCrumb } = await attempt(auth);
  if (!badCrumb) return body;

  clearYahooCrumbAuth();
  const refreshed = await getYahooCrumbAuth(true);
  if (!refreshed) return null;
  ({ body, badCrumb } = await attempt(refreshed));
  if (badCrumb) {
    clearYahooCrumbAuth();
    return null;
  }
  return body;
}
