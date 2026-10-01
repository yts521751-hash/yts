import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PanelProps = {
  children: ReactNode;
  className?: string;
  /** quiet：半透明底，用於次要區塊；outline：虛線空狀態容器 */
  tone?: "solid" | "quiet" | "outline";
  /** 預設無內距，交給 PanelBody／呼叫端決定 */
  padded?: boolean;
  as?: "section" | "div" | "article" | "aside";
};

export function Panel({
  children,
  className,
  tone = "solid",
  padded = false,
  as: Tag = "section",
}: PanelProps) {
  return (
    <Tag
      className={cn(
        tone === "quiet"
          ? "surface-quiet"
          : tone === "outline"
            ? "surface-outline"
            : "surface",
        padded && "p-3 sm:p-4",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function PanelHeader({
  title,
  eyebrow,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-x-4 gap-y-2",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? <p className="t-eyebrow mb-1">{eyebrow}</p> : null}
        <h2 className="t-title">{title}</h2>
        {description ? (
          <p className="t-meta mt-1 max-w-prose">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/** 面板內的分隔線（取代各處 border-border/30…/60） */
export function PanelDivider({ className }: { className?: string }) {
  return <div className={cn("h-px w-full bg-line", className)} />;
}
