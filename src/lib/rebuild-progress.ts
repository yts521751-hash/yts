/**
 * 背景重建進度（記憶體）。供首頁輪詢顯示百分比；完成後 idle。
 */

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

type Bag = typeof globalThis & {
  __jinchaoRebuildProgress?: RebuildProgress;
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

export function getRebuildProgress(): RebuildProgress {
  return { ...bag() };
}

export function setRebuildProgress(
  patch: Partial<Omit<RebuildProgress, "updatedAt">>,
) {
  const cur = bag();
  Object.assign(cur, patch, { updatedAt: Date.now() });
  if (typeof cur.percent === "number") {
    cur.percent = Math.max(0, Math.min(100, Math.round(cur.percent)));
  }
}

export function beginRebuildProgress(label = "開始同步") {
  setRebuildProgress({
    active: true,
    percent: 1,
    label,
    error: null,
  });
}

export function finishRebuildProgress(ok: boolean, error?: string | null) {
  if (ok) {
    setRebuildProgress({
      active: false,
      percent: 100,
      label: "同步完成",
      error: null,
    });
  } else {
    setRebuildProgress({
      active: false,
      percent: bag().percent,
      label: "同步失敗",
      error: error ?? "同步失敗",
    });
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
