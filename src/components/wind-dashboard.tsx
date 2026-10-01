"use client";

import { WIND_META, type WindReading } from "@/lib/wind-types";
import { cn } from "@/lib/utils";
import { Panel } from "@/components/ui/panel";
import { Stat } from "@/components/ui/stat";
import { StatusPill, Chip } from "@/components/ui/chip";

const ARC_LENGTH = 251;
const ZONES = [
  { from: 0, to: 36, label: "無風", color: "var(--mk-ebb)" },
  { from: 36, to: 62, label: "陣風", color: "var(--mk-rotate)" },
  { from: 62, to: 100, label: "強風", color: "var(--mk-surge)" },
] as const;

function needleAngle(score: number) {
  const t = Math.min(100, Math.max(0, score)) / 100;
  return -110 + t * 220;
}

function WindDial({ reading }: { reading: WindReading }) {
  const meta = WIND_META[reading.level];
  const angle = needleAngle(reading.score);
  const stance = reading.maStanceLabel || "均線糾結";
  const progress = (Math.min(100, Math.max(0, reading.score)) / 100) * ARC_LENGTH;

  return (
    <Panel as="article" padded className="flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="t-eyebrow mb-1">{reading.asOf}</p>
          <h2 className="t-title truncate">{reading.label}</h2>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <StatusPill
            label={reading.levelLabel}
            color={meta.color}
            background={`color-mix(in oklab, ${meta.color} 14%, transparent)`}
          />
          <Chip>{stance}</Chip>
        </div>
      </div>

      <div className="mx-auto mt-4 w-full max-w-[300px]">
        <svg viewBox="0 0 200 108" className="h-auto w-full" aria-hidden>
          {/* 底弧 */}
          <path
            d="M20 100 A80 80 0 0 1 180 100"
            fill="none"
            stroke="var(--line-strong)"
            strokeWidth="12"
            strokeLinecap="round"
          />
          {/* 實際分數 */}
          <path
            d="M20 100 A80 80 0 0 1 180 100"
            fill="none"
            stroke={meta.color}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={`${progress} ${ARC_LENGTH}`}
          />
          {/* 分級刻度：36／62 是強弱分界 */}
          {[0, 36, 62, 100].map((tick) => {
            const a = ((needleAngle(tick) - 90) * Math.PI) / 180;
            const r1 = 72;
            const r2 = 64;
            return (
              <line
                key={tick}
                x1={100 + Math.cos(a) * r1}
                y1={100 + Math.sin(a) * r1}
                x2={100 + Math.cos(a) * r2}
                y2={100 + Math.sin(a) * r2}
                stroke="currentColor"
                strokeOpacity="0.3"
                strokeWidth="1.4"
              />
            );
          })}
          <g transform={`rotate(${angle} 100 100)`}>
            <line
              x1="100"
              y1="100"
              x2="100"
              y2="40"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <circle cx="100" cy="100" r="4.5" fill="currentColor" />
            <circle cx="100" cy="100" r="2" fill="var(--panel)" />
          </g>
        </svg>
        <div className="mt-1 text-center">
          <p className="t-display num text-[2rem] leading-none">{reading.score}</p>
          <p className="t-kicker mt-1">結構強度（0–100）</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat
          label="日漲跌"
          value={`${reading.changePct > 0 ? "+" : ""}${reading.changePct.toFixed(2)}%`}
          tone={reading.changePct}
        />
        <Stat label="距 MA5" value={`${reading.bias5.toFixed(2)}%`} />
        <Stat label="距月線" value={`${reading.bias20.toFixed(2)}%`} />
        <Stat label="距季線" value={`${reading.bias60.toFixed(2)}%`} />
        <Stat label="波動（20 日）" value={`${reading.vol20.toFixed(2)}%`} />
        <Stat
          label="收盤"
          value={reading.close ? reading.close.toLocaleString("zh-TW") : "—"}
        />
      </div>

      <p className="t-meta mt-3 leading-relaxed">
        {meta.hint}
        {reading.source.includes("tradingIndex") ||
        reading.source.includes("FMTQIK")
          ? " · 指數來源為證交所／櫃買公開資料"
          : ""}
      </p>
    </Panel>
  );
}

export function WindDashboard({
  readings,
  className,
}: {
  readings: WindReading[];
  className?: string;
}) {
  return (
    <div className={cn("space-y-4 sm:space-y-6", className)}>
      <div className="grid gap-4 md:grid-cols-2">
        {readings.map((reading) => (
          <WindDial key={reading.market} reading={reading} />
        ))}
      </div>

      <Panel padded tone="quiet" as="section">
        <h2 className="t-title">怎麼讀</h2>
        <ul className="t-meta mt-2 list-disc space-y-1.5 pl-4 leading-relaxed">
          <li>
            <span className="font-medium text-foreground">強度分數</span>
            依指數相對 MA5／月／季線的細分位置計分（站上權重大、跌破權重小），避免「站上月季」與「跌破月季」同分。
          </li>
          <li>
            <span className="font-medium text-foreground">右上角均線標籤</span>
            ：多頭／空頭排列、站上月季線、低於五日、跌破月季線等。
          </li>
          <li>強風：結構分數約 62 以上（完整多空排列通常落在這帶）。</li>
          <li>陣風：結構分數約 36–61（半成形）；細看分數與右上角標籤。</li>
          <li>亂流：均線方向打架且波動偏高（覆寫分級）。</li>
          <li>無風：結構分數低於 36，或均線糾結且波動低。</li>
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          {ZONES.map((z) => (
            <span
              key={z.label}
              className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[0.6875rem] text-muted-foreground"
            >
              <span
                className="size-2 rounded-full"
                style={{ background: z.color }}
                aria-hidden
              />
              {z.label} {z.from}–{z.to}
            </span>
          ))}
        </div>
      </Panel>
    </div>
  );
}
