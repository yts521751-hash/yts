import {
  getRebuildProgress,
  subscribeRebuildProgress,
} from "@/lib/rebuild-progress";
import {
  isHistoryBackfillRunning,
  runHistoryBackfillExclusive,
} from "@/lib/history-backfill";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type SyncEvent =
  | {
      type: "progress";
      percent: number;
      label: string;
      active: boolean;
    }
  | {
      type: "done";
      ok: boolean;
      error?: string;
      quoteDays?: number;
      target?: number;
    };

/**
 * 前景同步：同一條連線以 NDJSON 推送進度，跑完才結束。
 * 首頁按鈕專用——不再背景更新 + 輪詢。
 */
export async function GET() {
  const encoder = new TextEncoder();
  let lastPercent = -1;
  let lastLabel = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: SyncEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      const pushProgress = (
        percent: number,
        label: string,
        active: boolean,
      ) => {
        const p = Math.max(0, Math.min(100, Math.round(percent)));
        const l = label || "同步中";
        if (p === lastPercent && l === lastLabel) return;
        lastPercent = p;
        lastLabel = l;
        send({ type: "progress", percent: p, label: l, active });
      };

      const unsub = subscribeRebuildProgress((prog) => {
        pushProgress(prog.percent, prog.label, prog.active);
      });

      try {
        const cur = getRebuildProgress();
        pushProgress(
          cur.active ? Math.max(1, cur.percent) : 1,
          cur.active ? cur.label || "同步中" : "開始同步…",
          true,
        );

        if (isHistoryBackfillRunning()) {
          await waitUntilIdle(pushProgress);
          const done = getRebuildProgress();
          send({
            type: "done",
            ok: !done.error,
            error: done.error ?? undefined,
          });
          return;
        }

        const { alreadyRunning, result } =
          await runHistoryBackfillExclusive("api-sync");
        if (alreadyRunning) {
          await waitUntilIdle(pushProgress);
          const done = getRebuildProgress();
          send({
            type: "done",
            ok: !done.error,
            error: done.error ?? undefined,
          });
          return;
        }

        pushProgress(100, "同步完成", false);
        send({
          type: "done",
          ok: true,
          quoteDays: result?.quoteDays,
          target: result?.target,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: "done", ok: false, error: message });
      } finally {
        unsub();
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}

async function waitUntilIdle(
  pushProgress: (percent: number, label: string, active: boolean) => void,
) {
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const prog = getRebuildProgress();
    pushProgress(
      Math.max(1, prog.percent || 1),
      prog.label || "同步中",
      prog.active || isHistoryBackfillRunning(),
    );
    if (!isHistoryBackfillRunning() && !prog.active) return;
    await new Promise((r) => setTimeout(r, 400));
  }
}
