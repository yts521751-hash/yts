"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Moon, Settings2, Sun, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MarketSwitch, marketFromPath, type MarketId } from "@/components/market-switch";
import { Segmented } from "@/components/ui/segmented";
import { IconButton } from "@/components/ui/action-button";
import { useAppearance, type TextSize } from "@/lib/use-appearance";

export type AppHeaderProps = {
  market?: MarketId;
  /** 資料日（首頁有 brief 時傳入） */
  dateLabel?: string;
  /** 更新時間字串 */
  updatedAt?: string;
  isDemo?: boolean;
  /** 波動情緒 */
  fearLabel?: string;
  fearScore?: number;
};

const TEXT_SIZE_ITEMS = [
  { value: "sm" as TextSize, label: "小" },
  { value: "md" as TextSize, label: "中" },
  { value: "lg" as TextSize, label: "大" },
];

function navItems(market: MarketId) {
  if (market === "us") {
    return [
      { href: "/us/wind", label: "風度" },
      { href: "/us/turnover", label: "成交排行" },
      { href: "/us/value", label: "價值選股" },
    ];
  }
  return [
    { href: "/ma", label: "均線掃描" },
    { href: "/wind", label: "風度" },
    { href: "/turnover", label: "成交排行" },
    { href: "/value", label: "價值選股" },
    { href: "/glossary", label: "名詞" },
  ];
}

function sourceNote(market: MarketId) {
  return market === "us"
    ? "YAHOO · NASDAQ PUBLIC DATA"
    : "TWSE · TPEX PUBLIC DATA";
}

export function AppHeader({
  market: marketProp,
  dateLabel,
  updatedAt,
  isDemo = false,
  fearLabel,
  fearScore,
}: AppHeaderProps) {
  const pathname = usePathname() || "/";
  const market = marketProp ?? marketFromPath(pathname);
  const { textSize, setTextSize, dark, toggleDark } = useAppearance();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const items = navItems(market);
  const home = market === "us" ? "/us" : "/";
  const hasFear = Boolean(fearLabel && fearLabel !== "—");

  return (
    <header className="relative z-30 border-b border-line bg-panel/92 backdrop-blur-md">
      <div
        className="h-0.5 w-full"
        style={{
          background:
            "linear-gradient(90deg, var(--mk-anchor) 0%, color-mix(in oklab, var(--mk-anchor) 45%, transparent) 72%, transparent 100%)",
        }}
        aria-hidden
      />
      <div className="mx-auto flex w-full max-w-[1440px] items-center gap-3 px-4 py-2.5 sm:px-6 sm:py-3">
        <Link
          href={home}
          className="group flex min-w-0 items-center gap-2.5 rounded-md"
        >
          <span className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md">
            <span
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(145deg, var(--mk-anchor) 0%, color-mix(in oklab, var(--mk-anchor) 78%, black) 100%)",
              }}
            />
            <span className="t-display relative text-xs font-bold tracking-[0.12em] text-white">
              流
            </span>
          </span>
          <span className="min-w-0">
            <span className="t-display block truncate text-lg leading-tight sm:text-xl">
              金流看板
            </span>
            <span className="t-eyebrow hidden sm:block">
              {market === "us" ? "US Cashflow Board" : "Cashflow Board"}
            </span>
          </span>
        </Link>

        <MarketSwitch className="ml-0.5 shrink-0" size="sm" />

        <div className="ml-auto flex items-center gap-2">
          {/* 桌面：量能情緒 + 資料日 + 導覽 + 外觀 */}
          <div className="hidden items-center gap-2 lg:flex">
            {hasFear ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-sunken px-2.5 py-1.5">
                <span className="t-eyebrow">VOL</span>
                <span className="text-xs font-medium">{fearLabel}</span>
                <span className="num text-xs text-muted-foreground">
                  {fearScore}
                </span>
              </span>
            ) : null}
            {dateLabel ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-sunken px-2.5 py-1.5">
                <span className="t-eyebrow">DATE</span>
                <span className="num text-xs font-medium">{dateLabel}</span>
                {isDemo ? (
                  <span
                    className="rounded-full px-1.5 text-[0.625rem] font-semibold"
                    style={{
                      background: "var(--mk-rotate-bg)",
                      color: "var(--mk-rotate)",
                    }}
                  >
                    DEMO
                  </span>
                ) : null}
              </span>
            ) : null}
            <nav aria-label="功能導覽" className="flex items-center gap-1">
              {items.map(({ href, label }) => {
                const active =
                  pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "inline-flex min-h-9 items-center rounded-lg px-2.5 text-xs font-medium transition-colors",
                      active
                        ? "bg-sunken text-foreground"
                        : "text-muted-foreground hover:bg-sunken hover:text-foreground",
                    )}
                  >
                    {label}
                  </Link>
                );
              })}
            </nav>
            <Segmented
              ariaLabel="字級"
              size="sm"
              items={TEXT_SIZE_ITEMS}
              value={textSize}
              onChange={setTextSize}
            />
            <IconButton
              label={dark ? "切換淺色" : "切換深色"}
              onClick={toggleDark}
              variant="outline"
            >
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </IconButton>
          </div>

          {/* 手機／平板：收進設定選單，避免 header 折成四行 */}
          <IconButton
            label="看板設定"
            variant="outline"
            className="lg:hidden"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? <X className="size-4" /> : <Settings2 className="size-4" />}
          </IconButton>
        </div>
      </div>

      {/* meta 條：資料日／更新時間／來源 */}
      <div className="mx-auto flex w-full max-w-[1440px] items-center justify-between gap-3 border-t border-line px-4 py-1.5 sm:px-6">
        <p className="t-eyebrow min-w-0 truncate">
          {dateLabel ? (
            <>
              <span className="lg:hidden">{dateLabel}</span>
              {updatedAt && updatedAt !== "—" ? (
                <>
                  <span className="lg:hidden"> · </span>
                  <span>UPDATED {updatedAt}</span>
                </>
              ) : null}
              {isDemo ? <span className="lg:hidden"> · DEMO</span> : null}
            </>
          ) : (
            <span>{market === "us" ? "US EDITION" : "TAIWAN EDITION"}</span>
          )}
        </p>
        <p className="t-eyebrow hidden shrink-0 sm:block">{sourceNote(market)}</p>
      </div>

      {menuOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/25 lg:hidden"
            aria-label="關閉設定"
            onClick={() => setMenuOpen(false)}
          />
          <div
            ref={menuRef}
            className="surface-raised absolute inset-x-3 top-full z-50 mt-2 space-y-4 p-4 lg:hidden"
          >
            <div>
              <p className="t-eyebrow mb-2">外觀</p>
              <div className="flex flex-wrap items-center gap-2">
                <Segmented
                  ariaLabel="字級"
                  items={TEXT_SIZE_ITEMS}
                  value={textSize}
                  onChange={setTextSize}
                />
                <button
                  type="button"
                  onClick={toggleDark}
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-sunken px-3.5 text-[0.8125rem] font-medium"
                >
                  {dark ? (
                    <Sun className="size-4" aria-hidden />
                  ) : (
                    <Moon className="size-4" aria-hidden />
                  )}
                  {dark ? "淺色" : "深色"}
                </button>
              </div>
            </div>

            <div>
              <p className="t-eyebrow mb-2">功能</p>
              <div className="grid grid-cols-2 gap-2">
                {items.map(({ href, label }) => {
                  const active =
                    pathname === href || pathname.startsWith(`${href}/`);
                  return (
                    <Link
                      key={href}
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "inline-flex min-h-11 items-center justify-center rounded-lg border px-3 text-[0.8125rem] font-medium transition-colors",
                        active
                          ? "border-[var(--mk-anchor)] bg-[var(--mk-anchor-bg)] text-foreground"
                          : "border-line bg-sunken text-muted-foreground",
                      )}
                    >
                      {label}
                    </Link>
                  );
                })}
              </div>
            </div>

            {hasFear || dateLabel ? (
              <div>
                <p className="t-eyebrow mb-2">看板狀態</p>
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  {dateLabel ? (
                    <div className="surface-sunken px-2.5 py-2">
                      <dt className="text-muted-foreground">資料日</dt>
                      <dd className="num mt-0.5 font-medium">{dateLabel}</dd>
                    </div>
                  ) : null}
                  {hasFear ? (
                    <div className="surface-sunken px-2.5 py-2">
                      <dt className="text-muted-foreground">波動情緒</dt>
                      <dd className="num mt-0.5 font-medium">
                        {fearLabel} {fearScore}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </div>
            ) : null}

            <p className="t-eyebrow">{sourceNote(market)}</p>
          </div>
        </>
      ) : null}
    </header>
  );
}
