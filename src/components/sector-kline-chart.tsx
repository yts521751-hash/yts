"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SectorCandle } from "@/lib/types";
import {
  formatPct,
  formatTurnoverYi,
  formatYiSigned,
  signedClass,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { Amount } from "@/components/ui/amount";

import { smaSeries } from "@/lib/ma";

type Props = { candles: SectorCandle[] };

const MA_PERIODS = [
  { key: "ma5", period: 5, color: "var(--ma-5)", label: "MA5" },
  { key: "ma10", period: 10, color: "var(--ma-10)", label: "MA10" },
  { key: "ma20", period: 20, color: "var(--ma-20)", label: "MA20" },
  { key: "ma60", period: 60, color: "var(--ma-60)", label: "MA60" },
] as const;

function polyline(
  xs: number[],
  ys: (number | null)[],
  yMap: (v: number) => number,
) {
  const parts: string[] = [];
  let drawing = false;
  for (let i = 0; i < ys.length; i++) {
    const v = ys[i];
    if (v == null || !Number.isFinite(v)) {
      drawing = false;
      continue;
    }
    const cmd = drawing ? "L" : "M";
    parts.push(`${cmd}${xs[i].toFixed(2)} ${yMap(v).toFixed(2)}`);
    drawing = true;
  }
  return parts.join(" ");
}

export function SectorKlineChart({ candles }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 初始／資料更新後捲到最右（最新 K 棒），手機不必再手動拖
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let cancelled = false;
    const scrollRight = () => {
      if (cancelled) return;
      el.scrollLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    };
    scrollRight();
    const raf = requestAnimationFrame(() => {
      scrollRight();
      requestAnimationFrame(scrollRight);
    });
    const timer = window.setTimeout(scrollRight, 120);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [candles]);

  const series = useMemo(() => {
    if (!candles.length) return null;
    const closes = candles.map((c) => c.close);
    const mas = Object.fromEntries(
      MA_PERIODS.map((m) => [m.key, smaSeries(closes, m.period)]),
    ) as Record<(typeof MA_PERIODS)[number]["key"], (number | null)[]>;

    const maVals = Object.values(mas).flatMap((arr) =>
      arr.filter((v): v is number => v != null),
    );
    const min = Math.min(...candles.map((c) => c.low), ...maVals);
    const max = Math.max(...candles.map((c) => c.high), ...maVals);
    const pad = (max - min) * 0.08 || 1;
    const flowMax = Math.max(
      ...candles.map((c) => Math.max(c.inflow, c.outflow, 0.01)),
    );
    return { yMin: min - pad, yMax: max + pad, flowMax, mas };
  }, [candles]);

  if (!candles.length || !series) {
    return (
      <div className="surface-outline flex h-72 items-center justify-center text-sm text-muted-foreground">
        尚無日線資料
      </div>
    );
  }

  const W = 900;
  const H_K = 300;
  const H_F = 110;
  const PAD_L = 8;
  const PAD_R = 8;
  const n = candles.length;
  const slot = (W - PAD_L - PAD_R) / n;
  const bodyW = Math.max(2, slot * 0.55);
  const xs = candles.map((_, i) => PAD_L + i * slot + slot / 2);
  const yK = (v: number) => {
    const t = (v - series.yMin) / (series.yMax - series.yMin);
    return H_K - t * (H_K - 16) - 8;
  };
  const activeIdx = hover != null ? hover : candles.length - 1;
  const active = candles[activeIdx];
  const gridLines = [0.25, 0.5, 0.75].map((t) => series.yMin + t * (series.yMax - series.yMin));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div>
          <p className="t-eyebrow">{active.date}</p>
          <p className="t-display num mt-1 flex items-baseline gap-2 text-[1.75rem] leading-none">
            {active.close.toFixed(2)}
            <span
              className={cn("text-base font-medium", signedClass(active.changePct))}
            >
              {formatPct(active.changePct)}
            </span>
          </p>
        </div>
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <div className="flex gap-1.5">
            <dt>開</dt>
            <dd className="num text-foreground/80">{active.open.toFixed(2)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>高</dt>
            <dd className="num text-foreground/80">{active.high.toFixed(2)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>低</dt>
            <dd className="num text-foreground/80">{active.low.toFixed(2)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>成交</dt>
            <dd>
              <Amount
                text={formatTurnoverYi(active.amount)}
                className="text-foreground/80"
              />
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt>淨流</dt>
            <dd>
              <Amount
                text={formatYiSigned(active.flow)}
                className={cn("font-medium", signedClass(active.flow))}
              />
            </dd>
          </div>
        </dl>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {MA_PERIODS.map((m) => {
          const v = series.mas[m.key][activeIdx];
          return (
            <span
              key={m.key}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-sunken px-2 py-0.5 text-[0.6875rem]"
            >
              <span
                className="h-0.5 w-3 rounded-full"
                style={{ background: m.color }}
                aria-hidden
              />
              <span className="text-muted-foreground">{m.label}</span>
              <span className="num">{v != null ? v.toFixed(2) : "—"}</span>
            </span>
          );
        })}
      </div>

      <div
        ref={scrollRef}
        className="scroll-x rounded-lg border border-line bg-sunken p-2"
      >
        <svg
          viewBox={`0 0 ${W} ${H_K + H_F + 24}`}
          className="h-auto w-full min-w-[640px]"
          role="img"
          aria-label="產業日線 K 線、均線與流入流出"
        >
          {gridLines.map((v) => (
            <line
              key={v}
              x1={0}
              y1={yK(v)}
              x2={W}
              y2={yK(v)}
              stroke="currentColor"
              strokeOpacity={0.08}
              strokeWidth={1}
            />
          ))}

          {candles.map((c, i) => {
            const x = xs[i];
            const up = c.close >= c.open;
            const color = up ? "var(--mk-up)" : "var(--mk-down)";
            const yO = yK(c.open);
            const yC = yK(c.close);
            const yH = yK(c.high);
            const yL = yK(c.low);
            const top = Math.min(yO, yC);
            const bodyH = Math.max(1.5, Math.abs(yC - yO));
            return (
              <g
                key={c.date}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onTouchStart={() => setHover(i)}
                className="cursor-crosshair"
              >
                <rect
                  x={PAD_L + i * slot}
                  y={0}
                  width={slot}
                  height={H_K + H_F}
                  fill={hover === i ? "currentColor" : "transparent"}
                  fillOpacity={hover === i ? 0.06 : 0}
                />
                <line
                  x1={x}
                  y1={yH}
                  x2={x}
                  y2={yL}
                  stroke={color}
                  strokeWidth={1.2}
                />
                <rect
                  x={x - bodyW / 2}
                  y={top}
                  width={bodyW}
                  height={bodyH}
                  fill={color}
                  opacity={0.92}
                  rx={0.5}
                />
              </g>
            );
          })}

          {MA_PERIODS.map((m) => (
            <path
              key={m.key}
              d={polyline(xs, series.mas[m.key], yK)}
              fill="none"
              stroke={m.color}
              strokeWidth={1.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.92}
            />
          ))}

          {hover != null ? (
            <line
              x1={xs[hover]}
              y1={0}
              x2={xs[hover]}
              y2={H_K}
              stroke="currentColor"
              strokeOpacity={0.3}
              strokeWidth={1}
              strokeDasharray="3 3"
              pointerEvents="none"
            />
          ) : null}

          <line
            x1={0}
            y1={H_K + 4}
            x2={W}
            y2={H_K + 4}
            stroke="currentColor"
            strokeOpacity={0.14}
          />
          <text
            x={PAD_L}
            y={H_K + 20}
            fill="currentColor"
            opacity={0.45}
            fontSize={11}
          >
            流入／流出（億）
          </text>
          {candles.map((c, i) => {
            const x = xs[i];
            const baseY = H_K + 28;
            const hIn = (c.inflow / series.flowMax) * ((H_F - 36) / 2);
            const hOut = (c.outflow / series.flowMax) * ((H_F - 36) / 2);
            const mid = baseY + (H_F - 36) / 2;
            return (
              <g
                key={`f-${c.date}`}
                onMouseEnter={() => setHover(i)}
                onTouchStart={() => setHover(i)}
              >
                <rect
                  x={x - bodyW / 2}
                  y={mid - hIn}
                  width={bodyW}
                  height={Math.max(0, hIn)}
                  fill="var(--mk-up)"
                  opacity={0.85}
                />
                <rect
                  x={x - bodyW / 2}
                  y={mid}
                  width={bodyW}
                  height={Math.max(0, hOut)}
                  fill="var(--mk-down)"
                  opacity={0.85}
                />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
