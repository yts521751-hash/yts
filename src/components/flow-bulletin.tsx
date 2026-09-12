"use client";

import { formatYiSigned, signedClass } from "@/lib/format";
import {
  buildFlowBulletin,
  type BulletinRow,
  type BulletinTone,
} from "@/lib/flow-bulletin";
import { cn } from "@/lib/utils";
import { useMemo } from "react";

const TONE_STYLE: Record<
  BulletinTone,
  { bar: string; badge: string; label: string }
> = {
  in: {
    bar: "border-[var(--mk-up)]/40 bg-[var(--mk-up)]/5",
    badge: "bg-[var(--mk-up)]/15 text-[var(--mk-up)]",
    label: "流入",
  },
  out: {
    bar: "border-[var(--mk-down)]/40 bg-[var(--mk-down)]/5",
    badge: "bg-[var(--mk-down)]/15 text-[var(--mk-down)]",
    label: "流出",
  },
  "flip-in": {
    bar: "border-[var(--mk-surge)]/40 bg-[var(--mk-surge)]/5",
    badge: "bg-[var(--mk-surge)]/15 text-[var(--mk-surge)]",
    label: "轉強",
  },
  "flip-out": {
    bar: "border-[var(--mk-watch)]/40 bg-[var(--mk-watch)]/5",
    badge: "bg-[var(--mk-watch)]/15 text-[var(--mk-watch)]",
    label: "轉弱",
  },
};

type Props = {
  title: string;
  rows: BulletinRow[];
};

export function FlowBulletin({ title, rows }: Props) {
  const sections = useMemo(() => buildFlowBulletin(rows), [rows]);

  return (
    <section className="border border-border bg-[var(--panel)] p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-base font-semibold tracking-tight sm:text-lg">
            {title}
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            對照當日／3 日／5 日淨流；四組固定顯示，各組最多前三名（無標的則顯示空）
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {sections.map((sec) => {
          const tone = TONE_STYLE[sec.tone];
          return (
            <div
              key={sec.key}
              className={cn("border px-3 py-2.5", tone.bar)}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{sec.title}</h3>
                <span
                  className={cn(
                    "px-1.5 py-0.5 text-[10px] font-medium",
                    tone.badge,
                  )}
                >
                  {tone.label}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {sec.hint}
              </p>
              {sec.items.length ? (
                <ol className="mt-2 space-y-1.5">
                  {sec.items.map((item, i) => (
                    <li
                      key={item.id}
                      className="flex items-baseline justify-between gap-2 text-xs"
                    >
                      <span className="min-w-0 truncate">
                        <span className="mr-1.5 tabular-nums text-muted-foreground">
                          {i + 1}.
                        </span>
                        {item.name}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 font-semibold tabular-nums",
                          signedClass(item.dayFlow),
                        )}
                      >
                        {formatYiSigned(item.dayFlow)}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-3 py-2 text-center text-[11px] text-muted-foreground">
                  目前無符合條件標的
                </p>
              )}
              <p className="mt-2 text-[10px] tabular-nums text-muted-foreground">
                數值為當日淨流；另對照 3／5 日方向
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
