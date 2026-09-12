"use client";

import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { BubbleChart } from "@/components/bubble-chart";
import { CpRanking } from "@/components/cp-ranking";
import { FocusPanel } from "@/components/focus-panel";
import { SectorDetail } from "@/components/sector-detail";
import { StatusCards } from "@/components/status-cards";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  MARKET_BRIEF,
  SECTORS,
  countByStatus,
  getContrarianSectors,
  getCpRanking,
  getTopBuySectors,
} from "@/lib/mock-data";
import type { SectorFlow, TideStatus } from "@/lib/types";

type TextSize = "sm" | "md" | "lg";

export function HomeApp() {
  const [filter, setFilter] = useState<TideStatus | "all">("all");
  const [selected, setSelected] = useState<SectorFlow | null>(null);
  const [textSize, setTextSize] = useState<TextSize>("sm");
  const [dark, setDark] = useState(false);

  useEffect(() => {
    try {
      const ts = (localStorage.getItem("jinchao_text") as TextSize) || "sm";
      const theme = localStorage.getItem("jinchao_theme");
      const preferDark =
        theme === "dark" ||
        (theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      setTextSize(ts);
      setDark(preferDark);
      document.documentElement.dataset.textsize = ts;
      document.documentElement.classList.toggle("dark", preferDark);
    } catch {
      /* ignore */
    }
  }, []);

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

  const counts = useMemo(() => countByStatus(SECTORS), []);
  const cp = useMemo(() => getCpRanking(SECTORS), []);
  const contrarian = useMemo(() => getContrarianSectors(SECTORS), []);
  const topBuys = useMemo(() => getTopBuySectors(SECTORS), []);

  const onSelect = (s: SectorFlow) => setSelected(s);

  return (
    <div className="relative flex min-h-full flex-1 flex-col">
      <div className="tide-atmosphere pointer-events-none absolute inset-0" aria-hidden />
      <AppHeader
        dateLabel={MARKET_BRIEF.date}
        updatedAt={MARKET_BRIEF.updatedAt}
        isDemo={MARKET_BRIEF.isDemo}
        fearLabel={MARKET_BRIEF.fearLabel}
        fearScore={MARKET_BRIEF.fearScore}
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
                板塊輪動泡泡圖
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                越右＝近 5 日買越多 · 越上＝比近 20 日平均更偏買 · 圈越大＝近 20 日金額越大
              </p>
            </div>
          </div>
          <StatusCards counts={counts} active={filter} onChange={setFilter} />
        </section>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
          <div className="min-h-[480px] rounded-2xl border border-border/60 bg-[var(--panel)]/65 p-2 shadow-sm backdrop-blur-sm sm:p-3">
            <BubbleChart
              sectors={SECTORS}
              selectedId={selected?.id}
              onSelect={onSelect}
              filter={filter}
            />
          </div>
          <SectorDetail sector={selected} onClose={() => setSelected(null)} />
        </section>

        <FocusPanel
          market={MARKET_BRIEF}
          contrarian={contrarian}
          topBuys={topBuys}
          onSelect={onSelect}
        />

        <section className="rounded-2xl border border-border/60 bg-[var(--panel)]/70 p-4 backdrop-blur-sm">
          <Tabs defaultValue="cp">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <TabsList>
                <TabsTrigger value="cp">CP 值排行</TabsTrigger>
                <TabsTrigger value="how">怎麼看這張圖</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="cp" className="mt-4">
              <CpRanking items={cp} onSelect={onSelect} selectedId={selected?.id} />
            </TabsContent>
            <TabsContent value="how" className="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground">
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
                右上角是「流入而且還在加速」的那一區。泡泡大小只代表近 20 日金額規模，不代表好壞。
                同板塊裡可能有人買、有人賣——一定要點進去看成分股。
              </p>
              <p>
                本版先以示範資料呈現完整操作流程；之後可接上真實盤後法人資料源。僅供研究參考，不構成投資建議。
              </p>
            </TabsContent>
          </Tabs>
        </section>
      </main>

      <footer className="relative z-10 border-t border-border/40 py-4 text-center text-[11px] text-muted-foreground">
        金潮 JinChao · 靈感來自潮汐式板塊金流解讀 · 示範資料非即時行情
      </footer>
    </div>
  );
}
