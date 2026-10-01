/**
 * Yahoo Finance cookie + crumb（quoteSummary 等需授權的端點）。
 * 與 chart API 不同：無 crumb 會 401 Invalid Crumb。
 */

import { execFile } from "child_process";
import { promisify } from "util";

const run = promisify(execFile);

export type YahooCrumbAuth = { crumb: string; jar: string; at: number };

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

let cached: YahooCrumbAuth | null = null;

export async function getYahooCrumbAuth(force = false): Promise<YahooCrumbAuth | null> {
  if (!force && cached && Date.now() - cached.at < 30 * 60 * 1000) {
    return cached;
  }
  try {
    const jar = `/tmp/yahoo-crumb-${process.pid}.txt`;
    await run(
      "curl",
      ["-sS", "-c", jar, "-b", jar, "-A", UA, "-o", "/dev/null", "https://fc.yahoo.com"],
      { timeout: 20000 },
    );
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
        "https://query1.finance.yahoo.com/v1/test/getcrumb",
      ],
      { timeout: 20000 },
    );
    const crumb = String(stdout || "").trim();
    if (!crumb || crumb.includes("<") || crumb.includes(" ")) return null;
    cached = { crumb, jar, at: Date.now() };
    return cached;
  } catch {
    return null;
  }
}

/** 帶 cookie／crumb 的 curl GET，回傳 response body 文字 */
export async function yahooAuthedGet(
  url: string,
  auth: YahooCrumbAuth,
): Promise<string | null> {
  try {
    const sep = url.includes("?") ? "&" : "?";
    const full = `${url}${sep}crumb=${encodeURIComponent(auth.crumb)}`;
    const { stdout } = await run(
      "curl",
      ["-sS", "-b", auth.jar, "-c", auth.jar, "-A", UA, "-H", "Accept: application/json", full],
      { timeout: 20000, maxBuffer: 4 * 1024 * 1024 },
    );
    return String(stdout || "");
  } catch {
    return null;
  }
}
