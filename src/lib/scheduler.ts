import cron, { type ScheduledTask } from "node-cron";

export type ScheduleInfo = {
  enabled: boolean;
  timezone: string;
  expressions: string[];
  description: string;
  lastRunAt: string | null;
  lastResult: "ok" | "error" | "skipped" | null;
  lastError: string | null;
  running: boolean;
};

type SchedulerGlobal = {
  started?: boolean;
  tasks?: ScheduledTask[];
  state?: ScheduleInfo;
};

function bag(): SchedulerGlobal {
  const g = globalThis as typeof globalThis & {
    __jinchaoScheduler?: SchedulerGlobal;
  };
  if (!g.__jinchaoScheduler) g.__jinchaoScheduler = {};
  return g.__jinchaoScheduler;
}

const TZ = process.env.SYNC_TZ || "Asia/Taipei";

/**
 * 預設：週一～五 18:00、18:30、19:00（台北時間）
 * 可用環境變數覆寫：
 *   SYNC_CRON="0 18 * * 1-5;0 19 * * 1-5"
 *   SYNC_TZ="Asia/Taipei"
 *   SYNC_DISABLED=1
 */
function resolveExpressions(): string[] {
  const raw = process.env.SYNC_CRON?.trim();
  if (raw) {
    return raw
      .split(/[;|]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return ["0 18 * * 1-5", "30 18 * * 1-5", "0 19 * * 1-5"];
}

function describe(expressions: string[]): string {
  if (!expressions.length) return "未設定";
  if (
    expressions.includes("0 18 * * 1-5") &&
    expressions.includes("30 18 * * 1-5") &&
    expressions.includes("0 19 * * 1-5")
  ) {
    return `週一至週五 ${TZ} 18:00／18:30／19:00 自動同步`;
  }
  return `排程 ${expressions.join("、")}（時區 ${TZ}）`;
}

function ensureState(): ScheduleInfo {
  const b = bag();
  if (!b.state) {
    const expressions = resolveExpressions();
    b.state = {
      enabled: false,
      timezone: TZ,
      expressions,
      description:
        process.env.SYNC_DISABLED === "1"
          ? "已停用（SYNC_DISABLED=1）"
          : describe(expressions),
      lastRunAt: null,
      lastResult: null,
      lastError: null,
      running: false,
    };
  }
  return b.state;
}

async function runSync(reason: string) {
  const state = ensureState();
  if (state.running) {
    console.log(`[scheduler] skip (${reason}): already running`);
    return;
  }
  state.running = true;
  state.lastRunAt = new Date().toISOString();
  console.log(`[scheduler] start sync (${reason}) at ${state.lastRunAt}`);
  try {
    const { buildFlowPayload } = await import("@/lib/build-flow");
    const payload = await buildFlowPayload({ force: true });
    state.lastResult = "ok";
    state.lastError = null;
    console.log(
      `[scheduler] sync ok: ${payload.brief.date} sectors=${payload.sectors.length} source=${payload.source}`,
    );
  } catch (err) {
    state.lastResult = "error";
    state.lastError = err instanceof Error ? err.message : String(err);
    console.error(`[scheduler] sync failed:`, state.lastError);
  } finally {
    state.running = false;
  }
}

export function getScheduleInfo(): ScheduleInfo {
  return { ...ensureState() };
}

export function startScheduler() {
  const b = bag();
  if (b.started) return;
  b.started = true;
  b.tasks = [];

  const state = ensureState();

  if (process.env.SYNC_DISABLED === "1") {
    state.enabled = false;
    state.description = "已停用（SYNC_DISABLED=1）";
    console.log("[scheduler] disabled via SYNC_DISABLED=1");
    return;
  }

  const expressions = resolveExpressions();
  for (const expr of expressions) {
    if (!cron.validate(expr)) {
      console.error(`[scheduler] invalid cron: ${expr}`);
      continue;
    }
    const task = cron.schedule(
      expr,
      () => {
        void runSync(`cron:${expr}`);
      },
      { timezone: TZ },
    );
    b.tasks.push(task);
  }

  state.enabled = b.tasks.length > 0;
  state.expressions = expressions;
  state.description = describe(expressions);
  console.log(`[scheduler] started: ${state.description}`);
}
