export async function register() {
  // 只在 Node.js runtime 啟動排程（避免 edge 重複）
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("@/lib/scheduler");
    startScheduler();
  }
}
