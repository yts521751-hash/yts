"use client";

import { WIND_META, type WindReading } from "@/lib/wind-types";
import { cn } from "@/lib/utils";

function needleAngle(score: number) {
  const t = Math.min(100, Math.max(0, score)) / 100;
  return -110 + t * 220;
}

function WindDial({ reading }: { reading: WindReading }) {
  const meta = WIND_META[reading.level];
  const angle = needleAngle(reading.score);

  return (
    <article className="flex flex-col rounded-2xl border border-border/60 bg-[var(--panel)]/80 p-4 shadow-sm backdrop-blur-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold tracking-tight">
            {reading.label}
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            資料日 {reading.asOf}
          </p>
        </div>
        <span
          className="rounded-md px-2 py-1 text-xs font-semibold"
          style={{
            color: meta.color,
            background: `color-mix(in oklab, ${meta.color} 14%, transparent)`,
          }}
        >
          {reading.levelLabel}
        </span>
      </div>

      <div className="relative mx-auto mt-4 aspect-[2/1] w-full max-w-[280px]">
        <svg viewBox="0 0 200 110" className="h-full w-full" aria-hidden>
          <path
            d="M20 100 A80 80 0 0 1 180 100"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.12"
            strokeWidth="14"
            strokeLinecap="round"
          />
          <path
            d="M20 100 A80 80 0 0 1 180 100"
            fill="none"
            stroke={meta.color}
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={`${(reading.score / 100) * 251} 251`}
          />
          <g transform={`rotate(${angle} 100 100)`}>
            <line
              x1="100"
              y1="100"
              x2="100"
              y2="28"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <circle cx="100" cy="100" r="4" fill="currentColor" />
          </g>
        </svg>
        <div className="absolute inset-x-0 bottom-1 text-center">
          <p className="font-[family-name:var(--font-display)] text-3xl font-semibold tabular-nums">
            {reading.score}
          </p>
          <p className="text-[11px] text-muted-foreground">風力度</p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
        <div className="rounded-lg bg-muted/40 px-2.5 py-2">
          <dt className="text-muted-foreground">日漲跌</dt>
          <dd
            className={cn(
              "mt-0.5 font-semibold tabular-nums",
              reading.changePct > 0
                ? "text-[var(--mk-up)]"
                : reading.changePct < 0
                  ? "text-[var(--mk-down)]"
                  : "",
            )}
          >
            {reading.changePct > 0 ? "+" : ""}
            {reading.changePct.toFixed(2)}%
          </dd>
        </div>
        <div className="rounded-lg bg-muted/40 px-2.5 py-2">
          <dt className="text-muted-foreground">BIAS5</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">
            {reading.bias5.toFixed(2)}%
          </dd>
        </div>
        <div className="rounded-lg bg-muted/40 px-2.5 py-2">
          <dt className="text-muted-foreground">BIAS20</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">
            {reading.bias20.toFixed(2)}%
          </dd>
        </div>
        <div className="rounded-lg bg-muted/40 px-2.5 py-2">
          <dt className="text-muted-foreground">BIAS60</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">
            {reading.bias60.toFixed(2)}%
          </dd>
        </div>
        <div className="rounded-lg bg-muted/40 px-2.5 py-2">
          <dt className="text-muted-foreground">波動(20日)</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">
            {reading.vol20.toFixed(2)}%
          </dd>
        </div>
        <div className="rounded-lg bg-muted/40 px-2.5 py-2">
          <dt className="text-muted-foreground">收盤</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">
            {reading.close ? reading.close.toLocaleString("zh-TW") : "—"}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        {meta.hint}
        {reading.source.includes("tpex-turnover")
          ? " · 櫃買指數為上櫃股成交加權合成（非 Yahoo）"
          : ""}
      </p>
    </article>
  );
}

export function WindDashboard({
  twse,
  tpex,
  builtAt,
}: {
  twse: WindReading;
  tpex: WindReading;
  builtAt: string;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight sm:text-3xl">
            風度儀表板
          </h1>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            用均線乖離與波動，快速分辨上市／上櫃是強風、陣風、亂流還是無風
          </p>
        </div>
        <p className="text-[11px] text-muted-foreground">
          更新 {new Date(builtAt).toLocaleString("zh-TW", { hour12: false })}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <WindDial reading={twse} />
        <WindDial reading={tpex} />
      </div>

      <section className="rounded-2xl border border-border/50 bg-[var(--panel)]/60 p-4 text-xs text-muted-foreground">
        <h2 className="font-medium text-foreground">怎麼讀</h2>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>強風：均線排列清楚，趨勢方向明顯</li>
          <li>陣風：有短線方向，但均線尚未完全排齊</li>
          <li>亂流：波動偏高且訊號打架</li>
          <li>無風：乖離小、波動低</li>
        </ul>
      </section>
    </div>
  );
}
