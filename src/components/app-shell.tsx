"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppHeader } from "@/components/app-header";
import type { MarketId } from "@/components/market-switch";

export type ShellWidth = "wide" | "default" | "narrow";

const WIDTH_CLASS: Record<ShellWidth, string> = {
  wide: "max-w-[1440px]",
  default: "max-w-[1120px]",
  narrow: "max-w-[920px]",
};

export type AppShellProps = {
  children: ReactNode;
  market?: MarketId;
  width?: ShellWidth;
  /** header 資料（首頁才有 brief） */
  dateLabel?: string;
  updatedAt?: string;
  isDemo?: boolean;
  fearLabel?: string;
  fearScore?: number;
  /** header 上方的通知條（同步進度等） */
  banner?: ReactNode;
  /** 返回連結 */
  back?: { href: string; label: string } | null;
  eyebrow?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  /** 標題區下方的細節行（資料日、來源、更新時間） */
  meta?: ReactNode;
  /** 標題列右側動作 */
  actions?: ReactNode;
  /** 標題區與內容之間的提醒 */
  notice?: ReactNode;
  footerNote?: ReactNode;
  className?: string;
};

export function AppShell({
  children,
  market,
  width = "default",
  dateLabel,
  updatedAt,
  isDemo,
  fearLabel,
  fearScore,
  banner,
  back,
  eyebrow,
  title,
  description,
  meta,
  actions,
  notice,
  footerNote,
  className,
}: AppShellProps) {
  const container = cn("mx-auto w-full px-4 sm:px-6", WIDTH_CLASS[width]);
  const hasHead = Boolean(back || title || eyebrow || description || actions);

  return (
    <div className={cn("relative flex min-h-full flex-1 flex-col", className)}>
      <div
        className="studio-atmosphere pointer-events-none absolute inset-0"
        aria-hidden
      />
      <div className="relative z-30 md:sticky md:top-0">
        {banner}
        <AppHeader
          market={market}
          dateLabel={dateLabel}
          updatedAt={updatedAt}
          isDemo={isDemo}
          fearLabel={fearLabel}
          fearScore={fearScore}
        />
      </div>

      <main
        className={cn(
          container,
          "relative z-10 flex flex-1 flex-col gap-4 py-4 sm:gap-6 sm:py-6",
        )}
      >
        {hasHead ? (
          <div className="space-y-3">
            {back ? (
              <Link
                href={back.href}
                className="t-meta inline-flex min-h-9 items-center gap-1.5 rounded-md transition-colors hover:text-foreground"
              >
                <ArrowLeft className="size-4" aria-hidden />
                {back.label}
              </Link>
            ) : null}
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
              <div className="min-w-0">
                {eyebrow ? <p className="t-eyebrow mb-1.5">{eyebrow}</p> : null}
                {title ? <h1 className="t-page">{title}</h1> : null}
                {description ? (
                  <p className="t-meta mt-1.5 max-w-2xl leading-relaxed">
                    {description}
                  </p>
                ) : null}
              </div>
              {actions ? (
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {actions}
                </div>
              ) : null}
            </div>
            {meta ? <p className="t-kicker max-w-3xl">{meta}</p> : null}
            {notice}
          </div>
        ) : null}

        {children}
      </main>

      <ShellFooter market={market} note={footerNote} width={width} />
    </div>
  );
}

function ShellFooter({
  market,
  note,
  width,
}: {
  market?: MarketId;
  note?: ReactNode;
  width: ShellWidth;
}) {
  return (
    <footer className="relative z-10 mt-2 border-t border-line">
      <div
        className={cn(
          "mx-auto flex w-full flex-col items-center gap-1.5 px-4 py-5 text-center sm:px-6",
          WIDTH_CLASS[width],
        )}
      >
        <p className="t-eyebrow">金流看板 · CASHFLOW BOARD</p>
        <p className="t-meta">
          {note ??
            (market === "us"
              ? "資料來源：Yahoo Finance、Nasdaq 公開行情"
              : "資料來源：臺灣證券交易所、證券櫃檯買賣中心公開資料")}
        </p>
        {market !== "us" ? (
          <Link
            href="/glossary"
            className="t-meta underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            名詞小百科
          </Link>
        ) : null}
      </div>
    </footer>
  );
}
