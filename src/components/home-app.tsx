"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { CpRanking } from "@/components/cp-ranking";
import { FocusPanel } from "@/components/focus-panel";
import { SectorDetail } from "@/components/sector-detail";
import { SectorRanking } from "@/components/sector-ranking";
import { StatusCards } from "@/components/status-cards";
import {
  countByStatus,
  getContrarianSectors,
  getCpRanking,
  getTopBuySectors,
  migrateSectorIfNeeded,
} from "@/lib/mock-data";
import type { MarketBrief, SectorFlow, TideStatus } from "@/lib/types";

type TextSize = "sm" | "md" | "lg";
type LoadState = "loading" | "ready" | "error";

export function HomeApp() {
  const [filter, setFilter] = useState<TideStatus | "all">("all");
  const [selected, setSelected] = useState<SectorFlow | null>(null);
  const [textSize, setTextSize] = useState<TextSize>("sm");
  const [dark, setDark] = useState(false);
  const [sectors, setSectors] = useState<SectorFlow[]>([]);
  const [brief, setBrief] = useState<MarketBrief | null>(null);
  const [source, setSource] = useState("");
  const [scheduleHint, setScheduleHint] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    try {
      const ts = (localStorage.getItem("jinchao_text") as TextSize) || "sm";
      const theme = localStorage.getItem("jinchao_theme");
      const preferDark =
        theme === "dark" ||
        (theme !== "light" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);
      setTextSize(ts);
      setDark(preferDark);
      document.documentElement.dataset.textsize = ts;
      document.documentElement.classList.toggle("dark", preferDark);
    } catch {
      /* ignore */
    }
  }, []);

  const loadFlow = useCallback(async (force = false) => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(`/api/flow${force ? "?force=1" : ""}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!data.sectors?.length) throw new Error(data.error || "沒有板塊資料");
      const next = (data.sectors as SectorFlow[]).map(migrateSectorIfNeeded);
      setSectors(next);
      setBrief(data.brief as MarketBrief);
      setSource(String(data.source ?? ""));
      setScheduleHint(String(data.schedule?.description ?? ""));
      setSyncing(Boolean(data.syncing));
      setLoadState("ready");
      if (!data.ok && data.error) setError(String(data.error));
      setSelected((prev) => {
        if (!prev) return prev;
        return next.find((s) => s.id === prev.id) ?? null;
      });
    } catch (e) {
      setLoadState((s) => (s === "ready" ? "ready" : "error"));
      setError(e instanceof Error ? e.message : "載入失敗");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadFlow(false);
  }, [loadFlow]);

  useEffect(() => {
    if (!syncing) return;
    const t = setInterval(() => void loadFlow(false), 8000);
    return () => clearInterval(t);
  }, [syncing, loadFlow]);

  const onTextSize = (s: TextSize) => {
    setTextSize(s);
    document.documentElement.dataset.textsize = s;
    try {
      localStorage.setItem("jinchao_text", s);
    } catch {
      /* ignore */
    }
  };

  const onToggleDark = () => {
    setDark((d) => {
      const next = !d;
      document.documentElement.classList.toggle("dark", next);
      try {
        localStorage.setItem("jinchao_theme", next ? "dark" : "light");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const counts = useMemo(() => countByStatus(sectors), [sectors]);
  const cp = useMemo(() => getCpRanking(sectors), [sectors]);
  const volumeSpikes = useMemo(() => getContrarianSectors(sectors), [sectors]);
  const topTurnover = useMemo(() => getTopBuySectors(sectors), [sectors]);
  const isDemo = brief?.isDemo === true || source.includes("demo");

  return (
    <div className="relative flex min-h-full flex-1 flex-col">
      <div className="tide-atmosphere pointer-events-none absolute inset-0" aria-hidden />
      <AppHeader
        dateLabel={brief?.date ?? "載入中"}
        updatedAt={brief?.updatedAt ?? "—"}
        isDemo={isDemo}
        fearLabel={brief?.fearLabel ?? "—"}
        fearScore={brief?.fearScore ?? 0}
        textSize={textSize}
        onTextSize={onTextSize}
        dark={dark}
        onToggleDark={onToggleDark}
      />

      <main className="relative z-10 mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight sm:text-3xl">
                板塊資金流排行榜
              </h1>
            </div>
            <button
              type="button"
              onClick={() => void loadFlow(true)}
              disabled={refreshing || loadState === "loading"}
              className="rounded-xl border border-border/60 bg-[var(--panel)]/80 px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
            >
              {refreshing || loadState === "loading"
                ? "讀取中…"
                : syncing
                  ? "背景同步中…"
                  : "觸發背景更新"}
            </button>
          </div>

          {error && (
            <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              {isDemo
                ? `真實資料暫不可用，已改顯示示範資料：${error}`
                : `提醒：${error}`}
            </p>
          )}

          {loadState === "loading" && !sectors.length ? (
            <div className="rounded-2xl border border-border/50 bg-[var(--panel)]/60 px-4 py-10 text-center text-sm text-muted-foreground">
              載入中…
            </div>
          ) : loadState === "error" && !sectors.length ? (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-10 text-center text-sm">
              <p className="font-medium">無法載入資料</p>
              <p className="mt-1 text-muted-foreground">{error}</p>
              <button
                type="button"
                className="mt-3 rounded-lg border px-3 py-1.5 text-xs"
                onClick={() => void loadFlow(false)}
              >
                再試一次
              </button>
            </div>
          ) : (
            <StatusCards counts={counts} active={filter} onChange={setFilter} />
          )}
        </section>

        {sectors.length > 0 && (
          <>
            <section className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
              <div className="min-h-[480px] rounded-2xl border border-border/60 bg-[var(--panel)]/65 p-2 shadow-sm backdrop-blur-sm sm:p-3">
                <SectorRanking
                  sectors={sectors}
                  selectedId={selected?.id}
                  onSelect={setSelected}
                  filter={filter}
                />
              </div>
              <SectorDetail sector={selected} onClose={() => setSelected(null)} />
            </section>

            {brief && (
              <FocusPanel
                market={brief}
                volumeSpikes={volumeSpikes}
                topTurnover={topTurnover}
                onSelect={setSelected}
              />
            )}

            <section className="rounded-2xl border border-border/60 bg-[var(--panel)]/70 p-4 backdrop-blur-sm">
              <h2 className="mb-3 font-[family-name:var(--font-display)] text-lg font-semibold tracking-tight">
                CP 值精選
              </h2>
              <CpRanking
                items={cp}
                onSelect={setSelected}
                selectedId={selected?.id}
              />
            </section>
          </>
        )}
      </main>

      <footer className="relative z-10 border-t border-border/40 py-4 text-center text-[11px] text-muted-foreground">
        金潮
      </footer>
    </div>
  );
}
