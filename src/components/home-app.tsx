"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { CpRanking } from "@/components/cp-ranking";
import { FocusPanel } from "@/components/focus-panel";
import { SectorDetail } from "@/components/sector-detail";
import { SectorRanking } from "@/components/sector-ranking";
import { StatusCards } from "@/components/status-cards";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  countByStatus,
  getContrarianSectors,
  getCpRanking,
  getTopBuySectors,
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
      if (!data.sectors?.length) {
        throw new Error(data.error || "沒有板塊資料");
      }
      setSectors(data.sectors as SectorFlow[]);
      setBrief(data.brief as MarketBrief);
      setSource(String(data.source ?? ""));
      setScheduleHint(String(data.schedule?.description ?? ""));
      setLoadState("ready");
      if (!data.ok && data.error) setError(String(data.error));
      setSelected((prev) => {
        if (!prev) return prev;
        return (
          (data.sectors as SectorFlow[]).find((s) => s.id === prev.id) ?? null
        );
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
  const contrarian = useMemo(
    () => getContrarianSectors(sectors),
    [sectors],
  );
  const topBuys = useMemo(() => getTopBuySectors(sectors), [sectors]);
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
                板塊排行榜
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                依近 5 日、近 20 日淨額、加速度或 CP 值排序，點列看成分股法人分項
                {!isDemo && source ? ` · ${source}` : ""}
              </p>
              {scheduleHint ? (
                <p className="mt-1 text-xs text-muted-foreground/80">
                  自動同步：{scheduleHint}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => void loadFlow(true)}
              disabled={refreshing || loadState === "loading"}
              className="rounded-xl border border-border/60 bg-[var(--panel)]/80 px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
            >
              {refreshing || loadState === "loading"
                ? "同步證交所中…"
                : "強制更新"}
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
              正在向證交所／櫃買抓取近 20 個交易日三大法人買賣超，首次約需 1～2
              分鐘…
            </div>
          ) : loadState === "error" && !sectors.length ? (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-10 text-center text-sm">
              <p className="font-medium">無法載入金流資料</p>
              <p className="mt-1 text-muted-foreground">{error}</p>
              <button
                type="button"
                className="mt-3 rounded-lg border px-3 py-1.5 text-xs"
                onClick={() => void loadFlow(true)}
              >
                再試一次
              </button>
            </div>
          ) : (
            <StatusCards
              counts={counts}
              active={filter}
              onChange={setFilter}
            />
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
              <SectorDetail
                sector={selected}
                onClose={() => setSelected(null)}
              />
            </section>

            {brief && (
              <FocusPanel
                market={brief}
                contrarian={contrarian}
                topBuys={topBuys}
                onSelect={setSelected}
              />
            )}

            <section className="rounded-2xl border border-border/60 bg-[var(--panel)]/70 p-4 backdrop-blur-sm">
              <Tabs defaultValue="cp">
                <TabsList>
                  <TabsTrigger value="cp">CP 值精選</TabsTrigger>
                  <TabsTrigger value="how">怎麼看排行榜</TabsTrigger>
                </TabsList>
                <TabsContent value="cp" className="mt-4">
                  <CpRanking
                    items={cp}
                    onSelect={setSelected}
                    selectedId={selected?.id}
                  />
                </TabsContent>
                <TabsContent
                  value="how"
                  className="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground"
                >
                  <p>
                    排行榜預設依<strong className="text-foreground">近 5 日</strong>
                    買賣超排序；也可改依加速度、近 20 日淨額、規模、漲幅或 CP
                    值。點欄位標題可切換升／降序。
                  </p>
                  <p>
                    <strong className="text-foreground">漲潮</strong>
                    ＝資金流入且在加速；
                    <strong className="text-foreground">輪動</strong>
                    ＝還在流入但力道放緩；
                    <strong className="text-foreground">觀望</strong>
                    ＝流出但放緩；
                    <strong className="text-foreground">退潮</strong>
                    ＝資金加速流出。
                  </p>
                  <p>
                    金額由證交所／櫃買「三大法人買賣超股數 ×
                    當日收盤價」換算為億元；題材板塊成分為編輯定義。僅供研究參考，不構成投資建議。
                  </p>
                </TabsContent>
              </Tabs>
            </section>
          </>
        )}
      </main>

      <footer className="relative z-10 border-t border-border/40 py-4 text-center text-[11px] text-muted-foreground">
        金潮 JinChao · 法人金流來自證交所 T86／櫃買日報
        {isDemo ? " · 目前為示範後備資料" : " · 真實盤後資料"}
      </footer>
    </div>
  );
}
