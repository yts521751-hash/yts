"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Gauge, Home, Newspaper, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/", label: "資金流", icon: Home },
  { href: "/wind", label: "風度", icon: Gauge },
  { href: "/turnover", label: "成交", icon: BarChart3 },
  { href: "/news", label: "新聞", icon: Newspaper },
] as const;

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-[var(--panel)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      aria-label="主要導覽"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-4 gap-1 px-2 pt-1.5 pb-1">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/"
              ? pathname === "/"
              : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                className={cn(
                  "flex flex-col items-center gap-0.5 rounded-lg px-2 py-1.5 text-[11px] transition",
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
