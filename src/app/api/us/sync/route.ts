import {
  getRebuildProgress,
  subscribeRebuildProgress,
} from "@/lib/rebuild-progress";
import {
  isUsDailyCloseRunning,
  runUsDailyClosePackage,
} from "@/lib/daily-close-package-us";

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
      asOf?: string | null;
      artifacts?: Record<string, boolean>;
      market: "us";
    };

/**
 * 美股前景同步：NDJSON 進度，跑完美股日終大包。
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
        const l = label || "同步美股中";
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
          cur.active ? cur.label || "同步美股中" : "開始同步美股…",
          true,
        );

        if (isUsDailyCloseRunning()) {
          await waitUntilIdle(pushProgress);
          const done = getRebuildProgress();
          send({
            type: "done",
            ok: !done.error,
            error: done.error ?? undefined,
            market: "us",
          });
          return;
        }

        const meta = await runUsDailyClosePackage("api-us-sync");
        pushProgress(100, "美股同步完成", false);
        send({
          type: "done",
          ok: Boolean(meta.artifacts.flow),
          asOf: meta.asOf,
          artifacts: meta.artifacts,
          market: "us",
          error: meta.artifacts.flow
            ? undefined
            : meta.steps.find((s) => !s.ok)?.detail || "美股大包未完成",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: "done", ok: false, error: message, market: "us" });
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
      prog.label || "同步美股中",
      prog.active || isUsDailyCloseRunning(),
    );
    if (!isUsDailyCloseRunning() && !prog.active) return;
    await new Promise((r) => setTimeout(r, 400));
  }
}
