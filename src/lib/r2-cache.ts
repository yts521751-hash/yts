/**
 * Cloudflare R2 外掛快取（S3 相容）。
 *
 * 本機／容器仍寫 CACHE_DIR；有設定 R2 時：
 * - 寫入後上傳到 R2
 * - 本機缺檔時從 R2 拉回
 * - 開機時把 R2 上的快照還原到本機（redeploy 後不必重同步）
 *
 * 環境變數見 .env.example／DEPLOY.md。
 */

import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { access, mkdir, readdir, writeFile } from "fs/promises";
import path from "path";

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  prefix: string;
  endpoint: string;
};

let client: S3Client | null = null;
let cachedConfig: R2Config | null | undefined;
let hydratePromise: Promise<{ downloaded: number; skipped: number }> | null =
  null;
/** 進行中的 write-through 上傳；sync 結束前必須 flush，避免 Free 休眠丟上傳 */
const pendingUploads = new Set<Promise<boolean>>();
let loggedConfigHint = false;

function trimSlash(s: string) {
  return s.replace(/^\/+|\/+$/g, "");
}

/** 正規化 R2 endpoint：強制 https、去掉尾斜線、去掉誤貼的 bucket path。 */
export function normalizeR2Endpoint(
  raw: string,
  accountId: string,
): { endpoint: string; warnings: string[] } {
  const warnings: string[] = [];
  let endpoint = (raw || "").trim();
  if (!endpoint && accountId) {
    endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  }
  if (!endpoint) return { endpoint: "", warnings };

  // 允許使用者貼「裸 hostname」
  if (!/^https?:\/\//i.test(endpoint)) {
    endpoint = `https://${endpoint}`;
  }
  if (/^http:\/\//i.test(endpoint)) {
    warnings.push("R2_ENDPOINT used http://; upgraded to https://");
    endpoint = endpoint.replace(/^http:\/\//i, "https://");
  }

  try {
    const u = new URL(endpoint);
    // 誤把 bucket 寫進 path：https://<id>.r2.../bucket-name
    if (u.pathname && u.pathname !== "/") {
      warnings.push(
        `R2_ENDPOINT had path "${u.pathname}" (bucket belongs in R2_BUCKET); stripped`,
      );
      u.pathname = "/";
    }
    u.search = "";
    u.hash = "";
    // hostname 應為 <account>.r2.cloudflarestorage.com 或 juris 變體
    const host = u.hostname.toLowerCase();
    if (
      host.includes("r2.cloudflarestorage.com") &&
      accountId &&
      !host.startsWith(`${accountId.toLowerCase()}.`)
    ) {
      // 可能是虛擬主機式誤貼 bucket.<account>.r2...
      const m = /^([^.]+)\.([0-9a-f]{32})\.r2\.cloudflarestorage\.com$/i.exec(
        host,
      );
      if (m) {
        warnings.push(
          `R2_ENDPOINT looked like bucket-virtual host (${host}); using account endpoint`,
        );
        u.hostname = `${m[2]}.r2.cloudflarestorage.com`;
      }
    }
    endpoint = u.origin;
  } catch {
    warnings.push("R2_ENDPOINT is not a valid URL");
  }

  return { endpoint: trimSlash(endpoint), warnings };
}

function formatR2Error(err: unknown): { msg: string; kind: string } {
  const msg = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: string }).code || "")
      : "";
  const name =
    err && typeof err === "object" && "name" in err
      ? String((err as { name?: string }).name || "")
      : "";

  if (
    /EPROTO|handshake failure|SSL alert number 40|ERR_SSL|CERT_|UNABLE_TO_VERIFY/i.test(
      msg,
    ) ||
    /EPROTO/.test(code)
  ) {
    return {
      kind: "tls",
      msg: `${msg} [tls/handshake — check R2_ACCOUNT_ID / R2_ENDPOINT hostname; client uses path-style https://<account>.r2.cloudflarestorage.com/<bucket>/…]`,
    };
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg) || /ENOTFOUND/.test(code)) {
    return {
      kind: "dns",
      msg: `${msg} [dns — R2_ACCOUNT_ID or R2_ENDPOINT hostname is wrong]`,
    };
  }
  if (
    /AccessDenied|InvalidAccessKeyId|SignatureDoesNotMatch|InvalidArgument/i.test(
      msg,
    ) ||
    /AccessDenied|InvalidAccessKeyId|SignatureDoesNotMatch/.test(name)
  ) {
    return {
      kind: "auth",
      msg: `${msg} [auth — check R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / token bucket permission]`,
    };
  }
  if (/NoSuchBucket/i.test(msg) || /NoSuchBucket/.test(name)) {
    return {
      kind: "bucket",
      msg: `${msg} [bucket — check R2_BUCKET name]`,
    };
  }
  if (/NoSuchKey|NotFound|404/i.test(msg) || /NoSuchKey|NotFound/.test(name)) {
    return { kind: "missing", msg };
  }
  return { kind: "other", msg };
}

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 2,
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const { kind } = formatR2Error(err);
      // TLS／auth／缺檔重試無意義；僅短暫網路錯誤再試一次
      if (kind === "tls" || kind === "auth" || kind === "missing" || kind === "bucket" || kind === "dns") {
        throw err;
      }
      if (i + 1 < attempts) {
        await new Promise((r) => setTimeout(r, 250 * (i + 1)));
        continue;
      }
    }
  }
  throw last;
}

export function getR2Config(): R2Config | null {
  if (cachedConfig !== undefined) return cachedConfig;
  const accountId = process.env.R2_ACCOUNT_ID?.trim() || "";
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim() || "";
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim() || "";
  const bucket = process.env.R2_BUCKET?.trim() || "";
  const prefix = trimSlash(process.env.R2_PREFIX?.trim() || "jinliu-cache");
  const { endpoint, warnings } = normalizeR2Endpoint(
    process.env.R2_ENDPOINT?.trim() || "",
    accountId,
  );

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !endpoint) {
    cachedConfig = null;
    return null;
  }

  if (!loggedConfigHint) {
    loggedConfigHint = true;
    if (accountId && !/^[0-9a-f]{32}$/i.test(accountId)) {
      console.warn(
        `[r2] R2_ACCOUNT_ID looks unusual (expected 32-char hex); endpoint=${endpoint}`,
      );
    }
    for (const w of warnings) console.warn(`[r2] ${w}`);
    console.log(
      `[r2] client endpoint=${endpoint} bucket=${bucket} prefix=${prefix || "(none)"} pathStyle=true`,
    );
  }

  cachedConfig = {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    prefix,
    endpoint,
  };
  return cachedConfig;
}

export function isR2Enabled() {
  return getR2Config() != null;
}

function getClient(): S3Client | null {
  const cfg = getR2Config();
  if (!cfg) return null;
  if (!client) {
    // forcePathStyle：避免 SDK 走虛擬主機式
    //   https://<bucket>.<account>.r2.cloudflarestorage.com
    // 該 hostname 不在 R2 憑證 wildcard（*.r2.cloudflarestorage.com）內，
    // 會在握手階段直接 EPROTO / SSL alert 40。
    client = new S3Client({
      region: "auto",
      endpoint: cfg.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    });
  }
  return client;
}

function objectKey(name: string) {
  const cfg = getR2Config();
  if (!cfg) return name;
  const clean = name.replace(/^\/+/, "");
  return cfg.prefix ? `${cfg.prefix}/${clean}` : clean;
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx]);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, Math.max(items.length, 1)) },
      () => run(),
    ),
  );
}

/** 上傳單一快取檔到 R2（失敗只打 log，不影響本機寫入） */
export async function uploadCacheFileToR2(
  name: string,
  body: string | Buffer,
): Promise<boolean> {
  const s3 = getClient();
  const cfg = getR2Config();
  if (!s3 || !cfg) return false;
  try {
    await withRetry(`upload ${name}`, () =>
      s3.send(
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: objectKey(name),
          Body: typeof body === "string" ? Buffer.from(body, "utf8") : body,
          ContentType: "application/json; charset=utf-8",
        }),
      ),
    );
    return true;
  } catch (err) {
    const { msg } = formatR2Error(err);
    console.error(`[r2] upload failed ${name}:`, msg);
    return false;
  }
}

/** 追蹤背景上傳，供 sync 結束 flush */
export function trackR2Upload(p: Promise<boolean>): Promise<boolean> {
  pendingUploads.add(p);
  void p.finally(() => {
    pendingUploads.delete(p);
  });
  return p;
}

/** 等待目前所有 write-through 上傳結束（成功或失敗都算） */
export async function flushR2Uploads(options?: {
  timeoutMs?: number;
}): Promise<{ pending: number; timedOut?: boolean }> {
  const batch = [...pendingUploads];
  if (!batch.length) return { pending: 0 };
  const timeoutMs = options?.timeoutMs;
  if (!timeoutMs || timeoutMs <= 0) {
    await Promise.allSettled(batch);
    return { pending: batch.length };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.allSettled(batch).then(() => "ok" as const),
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), timeoutMs);
      }),
    ]);
    return {
      pending: batch.length,
      timedOut: result === "timeout",
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 從 R2 讀取 JSON 字串；沒有或不存在回 null */
export async function downloadCacheFileFromR2(
  name: string,
): Promise<string | null> {
  const s3 = getClient();
  const cfg = getR2Config();
  if (!s3 || !cfg) return null;
  try {
    const res = await withRetry(`download ${name}`, () =>
      s3.send(
        new GetObjectCommand({
          Bucket: cfg.bucket,
          Key: objectKey(name),
        }),
      ),
    );
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes?.length) return null;
    return Buffer.from(bytes).toString("utf8");
  } catch (err) {
    const { msg, kind } = formatR2Error(err);
    // NoSuchKey 很常見，靜默
    if (kind === "missing") return null;
    console.error(`[r2] download failed ${name}:`, msg);
    return null;
  }
}

async function listAllKeys(): Promise<string[]> {
  const s3 = getClient();
  const cfg = getR2Config();
  if (!s3 || !cfg) return [];
  const keys: string[] = [];
  let token: string | undefined;
  const prefix = cfg.prefix ? `${cfg.prefix}/` : "";
  try {
    do {
      const res = await withRetry("list", () =>
        s3.send(
          new ListObjectsV2Command({
            Bucket: cfg.bucket,
            Prefix: prefix,
            ContinuationToken: token,
          }),
        ),
      );
      for (const obj of res.Contents ?? []) {
        if (obj.Key && !obj.Key.endsWith("/")) keys.push(obj.Key);
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
  } catch (err) {
    const { msg } = formatR2Error(err);
    console.error(`[r2] list failed:`, msg);
  }
  return keys;
}

function keyToLocalName(key: string): string | null {
  const cfg = getR2Config();
  if (!cfg) return null;
  const prefix = cfg.prefix ? `${cfg.prefix}/` : "";
  if (prefix && !key.startsWith(prefix)) return null;
  return key.slice(prefix.length);
}

async function exists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 開機還原：把 R2 上的快取拉到本機 CACHE_DIR（已存在的檔案略過）。
 * 單飛；完成後清掉 promise，讓後續 sync 可再對帳（例如首跑 hydrate 時 R2 仍空）。
 */
export async function hydrateCacheFromR2(
  cacheDir: string,
): Promise<{ downloaded: number; skipped: number; total: number }> {
  if (!isR2Enabled()) {
    return { downloaded: 0, skipped: 0, total: 0 };
  }
  if (!hydratePromise) {
    hydratePromise = (async () => {
      const keys = await listAllKeys();
      let downloaded = 0;
      let skipped = 0;
      await mkdir(/* turbopackIgnore: true */ cacheDir, { recursive: true });
      await mapPool(keys, 6, async (key) => {
        const name = keyToLocalName(key);
        if (!name) return;
        const dest = path.join(/* turbopackIgnore: true */ cacheDir, name);
        if (await exists(dest)) {
          skipped++;
          return;
        }
        const body = await downloadCacheFileFromR2(name);
        if (!body) return;
        await mkdir(/* turbopackIgnore: true */ path.dirname(dest), {
          recursive: true,
        });
        await writeFile(/* turbopackIgnore: true */ dest, body, "utf8");
        downloaded++;
      });
      console.log(
        `[r2] hydrate done: downloaded=${downloaded} skipped=${skipped} remote=${keys.length}`,
      );
      return { downloaded, skipped };
    })().finally(() => {
      hydratePromise = null;
    });
  }
  const result = await hydratePromise;
  return { ...result, total: result.downloaded + result.skipped };
}

/** 把本機 CACHE_DIR 全部推上 R2（首次搬家／手動備份用） */
export async function uploadLocalCacheDirToR2(
  cacheDir: string,
): Promise<{ uploaded: number }> {
  if (!isR2Enabled()) return { uploaded: 0 };
  let names: string[] = [];
  try {
    names = (
      await readdir(/* turbopackIgnore: true */ cacheDir)
    ).filter((n) => !n.startsWith("."));
  } catch {
    return { uploaded: 0 };
  }
  let uploaded = 0;
  await mapPool(names, 4, async (name) => {
    try {
      const { readFile } = await import("fs/promises");
      const local = path.join(/* turbopackIgnore: true */ cacheDir, name);
      const body = await readFile(/* turbopackIgnore: true */ local);
      const ok = await uploadCacheFileToR2(name, body);
      if (ok) uploaded++;
    } catch {
      /* skip */
    }
  });
  console.log(`[r2] upload local dir: uploaded=${uploaded}/${names.length}`);
  return { uploaded };
}
