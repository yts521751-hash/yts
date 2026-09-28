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

function trimSlash(s: string) {
  return s.replace(/^\/+|\/+$/g, "");
}

export function getR2Config(): R2Config | null {
  if (cachedConfig !== undefined) return cachedConfig;
  const accountId = process.env.R2_ACCOUNT_ID?.trim() || "";
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim() || "";
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim() || "";
  const bucket = process.env.R2_BUCKET?.trim() || "";
  const prefix = trimSlash(process.env.R2_PREFIX?.trim() || "jinliu-cache");
  const endpoint =
    process.env.R2_ENDPOINT?.trim() ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !endpoint) {
    cachedConfig = null;
    return null;
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
    client = new S3Client({
      region: "auto",
      endpoint: cfg.endpoint,
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
    await s3.send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: objectKey(name),
        Body: typeof body === "string" ? Buffer.from(body, "utf8") : body,
        ContentType: "application/json; charset=utf-8",
      }),
    );
    return true;
  } catch (err) {
    console.error(
      `[r2] upload failed ${name}:`,
      err instanceof Error ? err.message : err,
    );
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
export async function flushR2Uploads(): Promise<{ pending: number }> {
  const batch = [...pendingUploads];
  if (!batch.length) return { pending: 0 };
  await Promise.allSettled(batch);
  return { pending: batch.length };
}

/** 從 R2 讀取 JSON 字串；沒有或不存在回 null */
export async function downloadCacheFileFromR2(
  name: string,
): Promise<string | null> {
  const s3 = getClient();
  const cfg = getR2Config();
  if (!s3 || !cfg) return null;
  try {
    const res = await s3.send(
      new GetObjectCommand({
        Bucket: cfg.bucket,
        Key: objectKey(name),
      }),
    );
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes?.length) return null;
    return Buffer.from(bytes).toString("utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // NoSuchKey 很常見，靜默
    if (/NoSuchKey|NotFound|404/i.test(msg)) return null;
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
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: cfg.bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key && !obj.Key.endsWith("/")) keys.push(obj.Key);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
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
      await mkdir(cacheDir, { recursive: true });
      await mapPool(keys, 6, async (key) => {
        const name = keyToLocalName(key);
        if (!name) return;
        const dest = path.join(cacheDir, name);
        if (await exists(dest)) {
          skipped++;
          return;
        }
        const body = await downloadCacheFileFromR2(name);
        if (!body) return;
        await mkdir(path.dirname(dest), { recursive: true });
        await writeFile(dest, body, "utf8");
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
    names = (await readdir(cacheDir)).filter((n) => !n.startsWith("."));
  } catch {
    return { uploaded: 0 };
  }
  let uploaded = 0;
  await mapPool(names, 4, async (name) => {
    try {
      const { readFile } = await import("fs/promises");
      const body = await readFile(path.join(cacheDir, name));
      const ok = await uploadCacheFileToR2(name, body);
      if (ok) uploaded++;
    } catch {
      /* skip */
    }
  });
  console.log(`[r2] upload local dir: uploaded=${uploaded}/${names.length}`);
  return { uploaded };
}
