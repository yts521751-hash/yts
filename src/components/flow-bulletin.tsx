"use client";

import { formatMarketYiSigned, signedClass } from "@/lib/format";
import {
  buildFlowBulletin,
  type BulletinRow,
  type BulletinTone,
} from "@/lib/flow-bulletin";
import { cn } from "@/lib/utils";
import { useMemo } from "react";
import type { MarketId } from "@/components/market-switch";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Amount } from "@/components/ui/amount";

const TONE_STYLE: Record<
  BulletinTone,
  { accent: string; label: string }
> = {
  in: { accent: "var(--mk-up)", label: "流入" },
  out: { accent: "var(--mk-down)", label: "流出" },
  "flip-in": { accent: "var(--mk-surge)", label: "轉強" },
  "flip-out": { accent: "var(--mk-watch)", label: "轉弱" },
};

type Props = {
  title: string;
  rows: BulletinRow[];
  market?: MarketId;
};

export function FlowBulletin({ title, rows, market = "tw" }: Props) {
  const sections = useMemo(() => buildFlowBulletin(rows), [rows]);

  return (
    <Panel padded>
      <PanelHeader
        eyebrow="FLOW BULLETIN"
        title={title}
        description="對照當日／3 日／5 日淨流；四組固定顯示，各組最多前三名。"
      />

      {/* 手機：橫向 snap 卡片（避免四張卡把首頁拉長）；桌面：四欄 */}
      <div className="scroll-x -mx-3 mt-3 flex snap-x snap-mandatory gap-3 px-3 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-4">
        {sections.map((sec) => {
          const tone = TONE_STYLE[sec.tone];
          return (
            <div
              key={sec.key}
              className="relative min-w-[79%] shrink-0 snap-start overflow-hidden rounded-lg border border-line bg-sunken px-3 py-2.5 sm:min-w-0"
            >
              <span
                className="absolute inset-y-0 left-0 w-0.5"
                style={{ background: tone.accent }}
                aria-hidden
              />
              <div className="flex items-center justify-between gap-2">
                <h3 className="t-label">{sec.title}</h3>
                <span
                  className="rounded-full px-1.5 py-px text-[0.625rem] font-semibold"
                  style={{
                    color: tone.accent,
                    background: `color-mix(in oklab, ${tone.accent} 14%, transparent)`,
                  }}
                >
                  {tone.label}
                </span>
              </div>
              <p className="mt-1 text-[0.6875rem] leading-relaxed text-muted-foreground">
                {sec.hint}
              </p>
              {sec.items.length ? (
                <ol className="mt-2.5 space-y-1.5">
                  {sec.items.map((item, i) => (
                    <li
                      key={item.id}
                      className="flex items-baseline justify-between gap-2 text-xs"
                    >
                      <span className="flex min-w-0 items-baseline gap-1.5">
                        <span className="num w-3 shrink-0 text-right text-[0.6875rem] text-muted-foreground">
                          {i + 1}
                        </span>
                        <span className="truncate">{item.name}</span>
                      </span>
                      <Amount
                        text={formatMarketYiSigned(item.dayFlow, market)}
                        className={cn(
                          "shrink-0 font-semibold",
                          signedClass(item.dayFlow),
                        )}
                      />
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-3 py-2 text-center text-[0.6875rem] text-muted-foreground">
                  目前無符合條件標的
                </p>
              )}
            </div>
          );
        })}
      </div>
      <p className="t-kicker mt-2.5">數值為當日淨流</p>
    </Panel>
  );
}
