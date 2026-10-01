"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type MarketId = "tw" | "us";

export function marketFromPath(pathname: string | null): MarketId {
  if (!pathname) return "tw";
  return pathname === "/us" || pathname.startsWith("/us/") ? "us" : "tw";
}

export function marketHome(market: MarketId) {
  return market === "us" ? "/us" : "/";
}

export function marketHref(market: MarketId, path: string) {
  // path like "/ma", "/wind", "/" 
  if (market === "tw") return path === "" ? "/" : path;
  if (path === "/" || path === "") return "/us";
  return `/us${path}`;
}

/** 台股／美股切換（保留當前功能路徑） */
export function MarketSwitch({ className }: { className?: string }) {
  const pathname = usePathname() || "/";
  const market = marketFromPath(pathname);

  const rest = market === "us"
    ? pathname.replace(/^\/us/, "") || "/"
    : pathname;

  const twHref = rest === "/" ? "/" : rest;
  const usHref = rest === "/" ? "/us" : `/us${rest}`;

  return (
    <div
      className={cn(
        "inline-flex items-center border border-border bg-muted/40 p-0.5 font-mono text-[11px]",
        className,
      )}
      role="group"
      aria-label="市場切換"
    >
      <Link
        href={twHref}
        className={cn(
          "px-2.5 py-1 transition",
          market === "tw"
            ? "bg-[var(--mk-anchor)] font-semibold text-white"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        台股
      </Link>
      <Link
        href={usHref}
        className={cn(
          "px-2.5 py-1 transition",
          market === "us"
            ? "bg-[var(--mk-anchor)] font-semibold text-white"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        美股
      </Link>
    </div>
  );
}
