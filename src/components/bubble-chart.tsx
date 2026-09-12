"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SectorFlow, TideStatus } from "@/lib/types";
import { STATUS_META } from "@/lib/types";
import { formatYi } from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = {
  sectors: SectorFlow[];
  selectedId?: string | null;
  onSelect: (sector: SectorFlow) => void;
  filter?: TideStatus | "all";
};

const PAD = 48;

export function BubbleChart({ sectors, selectedId, onSelect, filter = "all" }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 520 });
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: Math.max(320, width), h: Math.max(360, height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const visible = useMemo(
    () => (filter === "all" ? sectors : sectors.filter((s) => s.status === filter)),
    [sectors, filter],
  );

  const domains = useMemo(() => {
    const xs = visible.map((s) => s.d5);
    const ys = visible.map((s) => s.accel);
    const padX = 12;
    const padY = 4;
    const minX = Math.min(-20, ...xs) - padX;
    const maxX = Math.max(20, ...xs) + padX;
    const minY = Math.min(-10, ...ys) - padY;
    const maxY = Math.max(10, ...ys) + padY;
    return { minX, maxX, minY, maxY };
  }, [visible]);

  const maxAbs = useMemo(
    () => Math.max(...visible.map((s) => s.d20Abs), 1),
    [visible],
  );

  const toXY = useCallback(
    (d5: number, accel: number) => {
      const { minX, maxX, minY, maxY } = domains;
      const iw = size.w - PAD * 2;
      const ih = size.h - PAD * 2;
      const x = PAD + ((d5 - minX) / (maxX - minX)) * iw;
      const y = PAD + (1 - (accel - minY) / (maxY - minY)) * ih;
      return { x, y };
    },
    [domains, size],
  );

  const radius = useCallback(
    (d20Abs: number) => {
      const t = Math.sqrt(d20Abs / maxAbs);
      return 10 + t * 36;
    },
    [maxAbs],
  );

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setView((v) => {
      const next = Math.min(4, Math.max(0.55, v.scale * factor));
      const k = next / v.scale;
      return {
        scale: next,
        tx: mx - (mx - v.tx) * k,
        ty: my - (my - v.ty) * k,
      };
    });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-bubble]")) return;
    drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setView((v) => ({
      ...v,
      tx: drag.current!.tx + (e.clientX - drag.current!.x),
      ty: drag.current!.ty + (e.clientY - drag.current!.y),
    }));
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  const origin = toXY(0, 0);
  const hover = visible.find((s) => s.id === hoverId) ?? null;

  return (
    <div className="relative flex h-full min-h-[420px] flex-col">
      <div
        ref={wrapRef}
        className="bubble-canvas relative flex-1 touch-none overflow-hidden rounded-2xl"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <svg width={size.w} height={size.h} className="absolute inset-0 h-full w-full">
          <defs>
            <radialGradient id="bubbleGlow" cx="35%" cy="30%" r="70%">
              <stop offset="0%" stopColor="white" stopOpacity="0.35" />
              <stop offset="100%" stopColor="white" stopOpacity="0" />
            </radialGradient>
            <filter id="softBlur" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="1.2" />
            </filter>
          </defs>

          <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
            {/* quadrant washes */}
            <rect
              x={origin.x}
              y={PAD}
              width={Math.max(0, size.w - PAD - origin.x)}
              height={Math.max(0, origin.y - PAD)}
              fill="var(--tide-surge)"
              opacity="0.06"
            />
            <rect
              x={origin.x}
              y={origin.y}
              width={Math.max(0, size.w - PAD - origin.x)}
              height={Math.max(0, size.h - PAD - origin.y)}
              fill="var(--tide-rotate)"
              opacity="0.06"
            />
            <rect
              x={PAD}
              y={PAD}
              width={Math.max(0, origin.x - PAD)}
              height={Math.max(0, origin.y - PAD)}
              fill="var(--tide-watch)"
              opacity="0.06"
            />
            <rect
              x={PAD}
              y={origin.y}
              width={Math.max(0, origin.x - PAD)}
              height={Math.max(0, size.h - PAD - origin.y)}
              fill="var(--tide-ebb)"
              opacity="0.06"
            />

            <line
              x1={PAD}
              y1={origin.y}
              x2={size.w - PAD}
              y2={origin.y}
              stroke="currentColor"
              strokeOpacity="0.18"
            />
            <line
              x1={origin.x}
              y1={PAD}
              x2={origin.x}
              y2={size.h - PAD}
              stroke="currentColor"
              strokeOpacity="0.18"
            />

            <text x={size.w - PAD} y={origin.y - 8} textAnchor="end" className="fill-muted-foreground text-[11px]">
              近 5 日買越多 →
            </text>
            <text x={origin.x + 8} y={PAD + 14} className="fill-muted-foreground text-[11px]">
              比 20 日均更偏買 ↑
            </text>

            <text x={origin.x + 12} y={PAD + 36} className="fill-[var(--tide-surge)] text-[12px] font-medium opacity-70">
              漲潮
            </text>
            <text
              x={origin.x + 12}
              y={size.h - PAD - 12}
              className="fill-[var(--tide-rotate)] text-[12px] font-medium opacity-70"
            >
              輪動
            </text>
            <text x={PAD + 12} y={PAD + 36} className="fill-[var(--tide-watch)] text-[12px] font-medium opacity-70">
              觀望
            </text>
            <text
              x={PAD + 12}
              y={size.h - PAD - 12}
              className="fill-[var(--tide-ebb)] text-[12px] font-medium opacity-70"
            >
              退潮
            </text>

            {visible.map((s) => {
              const { x, y } = toXY(s.d5, s.accel);
              const r = radius(s.d20Abs);
              const selected = s.id === selectedId;
              const hovered = s.id === hoverId;
              const meta = STATUS_META[s.status];
              return (
                <g
                  key={s.id}
                  data-bubble
                  transform={`translate(${x} ${y})`}
                  className="cursor-pointer"
                  onMouseEnter={() => setHoverId(s.id)}
                  onMouseLeave={() => setHoverId(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(s);
                  }}
                >
                  <circle
                    r={r + (selected || hovered ? 3 : 0)}
                    fill={meta.color}
                    fillOpacity={selected || hovered ? 0.55 : 0.38}
                    stroke={meta.color}
                    strokeWidth={selected ? 2.5 : 1.2}
                    strokeOpacity={0.95}
                    className="transition-[r,fill-opacity] duration-200"
                  />
                  <circle r={r} fill="url(#bubbleGlow)" pointerEvents="none" />
                  {s.contrarian && (
                    <circle
                      r={Math.max(4, r * 0.22)}
                      cx={r * 0.55}
                      cy={-r * 0.55}
                      fill="var(--tide-anchor)"
                      stroke="var(--background)"
                      strokeWidth="1.5"
                    />
                  )}
                  {r > 22 && (
                    <text
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className="pointer-events-none fill-[var(--tide-ink)] text-[10px] font-semibold"
                      style={{ fontSize: Math.min(12, r * 0.42) }}
                    >
                      {s.name.length > 5 ? s.name.slice(0, 4) + "…" : s.name}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {hover && (
          <div
            className={cn(
              "pointer-events-none absolute z-10 max-w-[240px] rounded-xl border border-border/60 bg-background/95 px-3 py-2 shadow-lg backdrop-blur-sm",
              "left-3 top-3 sm:left-auto sm:right-3",
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className="inline-block size-2.5 rounded-full"
                style={{ background: STATUS_META[hover.status].color }}
              />
              <p className="text-sm font-semibold">{hover.name}</p>
              <span className="text-xs text-muted-foreground">{STATUS_META[hover.status].label}</span>
            </div>
            <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
              <dt className="text-muted-foreground">近 5 日</dt>
              <dd className="font-medium tabular-nums">{formatYi(hover.d5)}</dd>
              <dt className="text-muted-foreground">加速度</dt>
              <dd className="font-medium tabular-nums">{formatYi(hover.accel)}/日</dd>
              <dt className="text-muted-foreground">近 20 日規模</dt>
              <dd className="font-medium tabular-nums">{formatYi(hover.d20Abs, 0)}</dd>
            </dl>
            {hover.contrarian && (
              <p className="mt-1.5 text-[11px] text-[var(--tide-anchor)]">⚓ 大跌日逆勢買超</p>
            )}
          </div>
        )}

        <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex flex-wrap items-end justify-between gap-2">
          <p className="rounded-lg bg-background/70 px-2.5 py-1 text-[11px] text-muted-foreground backdrop-blur-sm">
            滾輪縮放 · 拖曳移動 · 點泡泡看成分股
          </p>
          <button
            type="button"
            className="pointer-events-auto rounded-lg border border-border/70 bg-background/80 px-2.5 py-1 text-[11px] text-muted-foreground backdrop-blur-sm transition hover:text-foreground"
            onClick={() => setView({ scale: 1, tx: 0, ty: 0 })}
          >
            重設視角
          </button>
        </div>
      </div>
    </div>
  );
}
