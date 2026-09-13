/**
 * 背景重建進度。記憶體 + .cache 落盤，讓多實例／輪詢也能讀到百分比。
 */

import {
  readCacheFile,
  writeCacheFile,
} from "@/lib/tw-market";

export type RebuildProgress = {
  /** 是否正在背景同步 */
  active: boolean;
  /** 0–100 */
  percent: number;
  /** 短標籤，例如「補齊歷史報價」 */
  label: string;
  updatedAt: number;
  error: string | null;
};

const PROGRESS_CACHE = "rebuild-progress.json";

type ProgressListener = (progress: RebuildProgress) => void;

type Bag = typeof globalThis & {
  __jinchaoRebuildProgress?: RebuildProgress;
  __jinchaoRebuildProgressWrite?: Promise<void> | null;
  __jinchaoRebuildProgressTimer?: ReturnType<typeof setTimeout> | null;
  __jinchaoRebuildProgressListeners?: Set<ProgressListener>;
};

const IDLE: RebuildProgress = {
  active: false,
  percent: 0,
  label: "",
  updatedAt: 0,
  error: null,
};

function bag(): RebuildProgress {
  const g = globalThis as Bag;
  if (!g.__jinchaoRebuildProgress) {
    g.__jinchaoRebuildProgress = { ...IDLE };
  }
  return g.__jinchaoRebuildProgress;
}

function persistNow() {
  const g = globalThis as Bag;
  if (g.__jinchaoRebuildProgressTimer) {
    clearTimeout(g.__jinchaoRebuildProgressTimer);
    g.__jinchaoRebuildProgressTimer = null;
  }
  const snapshot = { ...bag() };
  g.__jinchaoRebuildProgressWrite = writeCacheFile(
    PROGRESS_CACHE,
    snapshot,
  ).catch((err) => {
    console.warn("[rebuild-progress] persist failed:", err);
  });
}

/** 進度更新節流寫盤；開始／結束會立刻落盤 */
function schedulePersist(immediate = false) {
  if (immediate) {
    persistNow();
    return;
  }
  const g = globalThis as Bag;
  if (g.__jinchaoRebuildProgressTimer) return;
  g.__jinchaoRebuildProgressTimer = setTimeout(() => {
    g.__jinchaoRebuildProgressTimer = null;
    persistNow();
  }, 250);
}

export function getRebuildProgress(): RebuildProgress {
  return { ...bag() };
}

/** API 輪詢用：記憶體與磁碟取較新／進行中的狀態（跨實例） */
export async function readRebuildProgress(): Promise<RebuildProgress> {
  const mem = bag();
  const disk = await readCacheFile<RebuildProgress>(PROGRESS_CACHE);
  if (!disk || typeof disk.percent !== "number") return { ...mem };

  const diskNewer = (disk.updatedAt || 0) >= (mem.updatedAt || 0);
  if (disk.active || (diskNewer && !mem.active)) {
    if (disk.active) Object.assign(mem, disk);
    return { ...IDLE, ...disk };
  }
  return { ...mem };
}

function listeners(): Set<ProgressListener> {
  const g = globalThis as Bag;
  if (!g.__jinchaoRebuildProgressListeners) {
    g.__jinchaoRebuildProgressListeners = new Set();
  }
  return g.__jinchaoRebuildProgressListeners;
}

/** 前景串流同步用：每次進度變更立刻通知訂閱者 */
export function subscribeRebuildProgress(fn: ProgressListener): () => void {
  listeners().add(fn);
  return () => {
    listeners().delete(fn);
  };
}

export function setRebuildProgress(
  patch: Partial<Omit<RebuildProgress, "updatedAt">>,
  opts?: { immediate?: boolean },
) {
  const cur = bag();
  Object.assign(cur, patch, { updatedAt: Date.now() });
  if (typeof cur.percent === "number") {
    cur.percent = Math.max(0, Math.min(100, Math.round(cur.percent)));
  }
  schedulePersist(Boolean(opts?.immediate));
  const snapshot = { ...cur };
  for (const fn of listeners()) {
    try {
      fn(snapshot);
    } catch {
      /* ignore listener errors */
    }
  }
}

export function beginRebuildProgress(label = "開始同步") {
  const cur = bag();
  // 已在同步中：只改標籤，不要把百分比打回 1%（前景串流會抖）
  if (cur.active) {
    setRebuildProgress({ label, error: null }, { immediate: true });
    return;
  }
  setRebuildProgress(
    {
      active: true,
      percent: 1,
      label,
      error: null,
    },
    { immediate: true },
  );
}

export function finishRebuildProgress(ok: boolean, error?: string | null) {
  if (ok) {
    setRebuildProgress(
      {
        active: false,
        percent: 100,
        label: "同步完成",
        error: null,
      },
      { immediate: true },
    );
  } else {
    setRebuildProgress(
      {
        active: false,
        percent: bag().percent,
        label: "同步失敗",
        error: error ?? "同步失敗",
      },
      { immediate: true },
    );
  }
}

/** 將子區間 [from,to] 依 done/total 線性對應 */
export function progressInRange(
  from: number,
  to: number,
  done: number,
  total: number,
): number {
  if (total <= 0) return to;
  const t = Math.min(1, Math.max(0, done / total));
  return from + (to - from) * t;
}
