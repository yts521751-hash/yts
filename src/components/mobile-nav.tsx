"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  ArrowLeftRight,
  Gauge,
  Home,
  BarChart3,
  Gem,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { marketFromPath } from "@/components/market-switch";

export function MobileNav() {
  const pathname = usePathname();
  const market = marketFromPath(pathname);

  const items =
    market === "us"
      ? ([
          { href: "/us", label: "資金流", icon: Home },
          { href: "/us/wind", label: "風度", icon: Gauge },
          { href: "/us/turnover", label: "成交", icon: BarChart3 },
          { href: "/us/value", label: "價值", icon: Gem },
        ] as const)
      : ([
          { href: "/", label: "資金流", icon: Home },
          { href: "/industry-flow", label: "產業流", icon: ArrowLeftRight },
          { href: "/ma", label: "均線", icon: Activity },
          { href: "/wind", label: "風度", icon: Gauge },
          { href: "/turnover", label: "成交", icon: BarChart3 },
          { href: "/value", label: "價值", icon: Gem },
        ] as const);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line-strong bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      aria-label="主要導覽"
    >
      <ul
        className={cn(
          "mx-auto grid max-w-lg",
          market === "us" ? "grid-cols-4" : "grid-cols-6",
        )}
      >
        {items.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/" || href === "/us"
              ? pathname === href
              : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-14 flex-col items-center justify-center gap-1 px-1 text-[0.6875rem] font-medium transition-colors",
                  active
                    ? "text-[var(--mk-anchor)]"
                    : "text-muted-foreground active:bg-sunken",
                )}
              >
                <span
                  className={cn(
                    "absolute inset-x-3 top-0 h-0.5 rounded-full transition-opacity",
                    active ? "opacity-100" : "opacity-0",
                  )}
                  style={{ background: "var(--mk-anchor)" }}
                  aria-hidden
                />
                <Icon className="size-[1.125rem]" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
