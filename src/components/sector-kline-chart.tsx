"use client";

import { useEffect, useMemo, useState } from "react";
import type { SectorCandle } from "@/lib/types";
import { formatPct, formatYi, formatYiSigned, signedClass } from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = { candles: SectorCandle[] };

const MA_PERIODS = [
  { key: "ma5", period: 5, color: "#d97706", label: "MA5" },
  { key: "ma10", period: 10, color: "#2563eb", label: "MA10" },
  { key: "ma20", period: 20, color: "#7c3aed", label: "MA20" },
  { key: "ma60", period: 60, color: "#0f766e", label: "MA60" },
] as const;

function movingAverage(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

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

  const series = useMemo(() => {
    if (!candles.length) return null;
    const closes = candles.map((c) => c.close);
    const mas = Object.fromEntries(
      MA_PERIODS.map((m) => [m.key, movingAverage(closes, m.period)]),
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
      <div className="flex h-72 items-center justify-center rounded-2xl border border-dashed border-border/60 text-sm text-muted-foreground">
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2 px-1">
        <div>
          <p className="text-xs text-muted-foreground">
            {active.date} · 產業日線（成交金額加權合成，基準 100）
          </p>
          <p className="mt-0.5 font-[family-name:var(--font-display)] text-2xl font-semibold tabular-nums">
            {active.close.toFixed(2)}
            <span className={cn("ml-2 text-base font-medium", signedClass(active.changePct))}>
              {formatPct(active.changePct)}
            </span>
          </p>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] tabular-nums">
            {MA_PERIODS.map((m) => {
              const v = series.mas[m.key][activeIdx];
              return (
                <span key={m.key} style={{ color: m.color }}>
                  {m.label} {v != null ? v.toFixed(2) : "—"}
                </span>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap gap-3 text-xs tabular-nums text-muted-foreground">
          <span>開 {active.open.toFixed(2)}</span>
          <span>高 {active.high.toFixed(2)}</span>
          <span>低 {active.low.toFixed(2)}</span>
          <span>成交 {formatYi(active.amount)}</span>
          <span className={signedClass(active.flow)}>
            淨流 {formatYiSigned(active.flow)}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border/50 bg-[var(--panel)]/50 p-2">
        <svg
          viewBox={`0 0 ${W} ${H_K + H_F + 24}`}
          className="h-auto w-full min-w-[640px]"
          role="img"
          aria-label="產業日線 K 線、均線與流入流出"
        >
          {candles.map((c, i) => {
            const x = xs[i];
            const up = c.close >= c.open;
            const color = up ? "var(--tide-up)" : "var(--tide-down)";
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
                className="cursor-crosshair"
              >
                <rect
                  x={PAD_L + i * slot}
                  y={0}
                  width={slot}
                  height={H_K + H_F}
                  fill={hover === i ? "rgba(128,128,128,0.08)" : "transparent"}
                />
                <line x1={x} y1={yH} x2={x} y2={yL} stroke={color} strokeWidth={1.2} />
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
              opacity={0.9}
            />
          ))}

          <line
            x1={0}
            y1={H_K + 4}
            x2={W}
            y2={H_K + 4}
            stroke="currentColor"
            strokeOpacity={0.15}
          />
          <text x={PAD_L} y={H_K + 20} fill="currentColor" opacity={0.45} fontSize={11}>
            流入／流出（億）
          </text>
          {candles.map((c, i) => {
            const x = xs[i];
            const baseY = H_K + 28;
            const hIn = (c.inflow / series.flowMax) * ((H_F - 36) / 2);
            const hOut = (c.outflow / series.flowMax) * ((H_F - 36) / 2);
            const mid = baseY + (H_F - 36) / 2;
            return (
              <g key={`f-${c.date}`} onMouseEnter={() => setHover(i)}>
                <rect
                  x={x - bodyW / 2}
                  y={mid - hIn}
                  width={bodyW}
                  height={Math.max(0, hIn)}
                  fill="var(--tide-up)"
                  opacity={0.85}
                />
                <rect
                  x={x - bodyW / 2}
                  y={mid}
                  width={bodyW}
                  height={Math.max(0, hOut)}
                  fill="var(--tide-down)"
                  opacity={0.85}
                />
              </g>
            );
          })}
        </svg>
      </div>

      <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
        日線：成分股當日成交金額加權報酬串成指數；均線為收盤價 MA5／10／20／60。
        下方綠柱流入、紅柱流出（
        <strong className="font-medium text-foreground/80">80%</strong> 成交×softSign(漲跌)＋
        <strong className="font-medium text-foreground/80">20%</strong> 法人買賣超）。
        {candles.length < 60 ? (
          <span className="ml-1 text-amber-700 dark:text-amber-300">
            目前快取 {candles.length} 根日K，MA60 需滿 60 根才會完整顯示；背景同步會繼續補齊。
          </span>
        ) : null}
      </p>
    </div>
  );
}

export function SectorKlinePanel({ sectorId }: { sectorId: string }) {
  const [candles, setCandles] = useState<SectorCandle[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/sector/${sectorId}?days=80`, {
          cache: "no-store",
          signal: AbortSignal.timeout(20000),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!data.ok || !data.candles?.length) {
          setError(data.error || "無法載入產業日線");
          setCandles([]);
        } else {
          setCandles(data.candles);
          setName(data.sectorName || "");
        }
      } catch (e) {
        if (cancelled) return;
        const msg =
          e instanceof Error && e.name === "TimeoutError"
            ? "載入逾時，請重整或回首頁觸發背景更新"
            : e instanceof Error
              ? e.message
              : "載入失敗";
        setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sectorId]);

  if (loading) {
    return (
      <div className="flex h-72 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <p>讀取產業日線…</p>
        <p className="text-xs opacity-70">通常不到 1 秒；若超過請重整或回首頁觸發背景更新</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-6 text-sm text-amber-900 dark:text-amber-100">
        {error}
        <p className="mt-2 text-xs opacity-80">
          產業日線只讀本機行情快取。請回首頁按「觸發背景更新」後再進來。
        </p>
      </div>
    );
  }

  return (
    <div>
      {name ? <p className="mb-2 text-xs text-muted-foreground">產業：{name} · 日線</p> : null}
      <SectorKlineChart candles={candles} />
    </div>
  );
}
