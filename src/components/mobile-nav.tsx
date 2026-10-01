"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Gauge, Home, BarChart3, Gem } from "lucide-react";
import { cn } from "@/lib/utils";
import { marketFromPath } from "@/components/market-switch";

export function MobileNav() {
  const pathname = usePathname();
  const market = marketFromPath(pathname);
  const prefix = market === "us" ? "/us" : "";

  const ITEMS =
    market === "us"
      ? ([
          { href: "/us", label: "資金流", icon: Home },
          { href: `${prefix}/wind`, label: "風度", icon: Gauge },
          { href: `${prefix}/turnover`, label: "成交", icon: BarChart3 },
          { href: `${prefix}/value`, label: "價值", icon: Gem },
        ] as const)
      : ([
          { href: "/", label: "資金流", icon: Home },
          { href: "/ma", label: "均線", icon: Activity },
          { href: "/wind", label: "風度", icon: Gauge },
          { href: "/turnover", label: "成交", icon: BarChart3 },
          { href: "/value", label: "價值", icon: Gem },
        ] as const);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-[var(--panel)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      aria-label="主要導覽"
    >
      <ul
        className={cn(
          "mx-auto grid max-w-lg gap-0.5 px-1.5 pt-1.5 pb-1",
          market === "us" ? "grid-cols-4" : "grid-cols-5",
        )}
      >
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/" || href === "/us"
              ? pathname === href
              : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                className={cn(
                  "flex min-h-[2.75rem] flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 text-[10px] transition sm:text-[11px]",
                  active
                    ? "bg-muted font-semibold text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
