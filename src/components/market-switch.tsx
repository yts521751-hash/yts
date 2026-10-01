"use client";

import { usePathname } from "next/navigation";
import { SegmentedLinks } from "@/components/ui/segmented";

export type MarketId = "tw" | "us";

export function marketFromPath(pathname: string | null): MarketId {
  if (!pathname) return "tw";
  return pathname === "/us" || pathname.startsWith("/us/") ? "us" : "tw";
}

export function marketHome(market: MarketId) {
  return market === "us" ? "/us" : "/";
}

/** 美股版不提供均線掃描／產業 K 線，對應路徑改回美股首頁 */
function usPathWithoutRemovedFeatures(path: string) {
  if (path === "/" || path === "") return "/us";
  if (path === "/ma" || path.startsWith("/ma/")) return "/us";
  if (path === "/sectors" || path.startsWith("/sectors/")) return "/us";
  return `/us${path}`;
}

export function marketHref(market: MarketId, path: string) {
  // path like "/ma", "/wind", "/"
  if (market === "tw") return path === "" ? "/" : path;
  return usPathWithoutRemovedFeatures(path);
}

/** 台股／美股切換（保留當前功能路徑；美股無均線／K 線時回 /us） */
export function MarketSwitch({
  className,
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md";
}) {
  const pathname = usePathname() || "/";
  const market = marketFromPath(pathname);

  const rest =
    market === "us" ? pathname.replace(/^\/us/, "") || "/" : pathname;

  const twHref = rest === "/" ? "/" : rest.startsWith("/") ? rest : `/${rest}`;
  // 從美股殘留 /us/ma、/us/sectors 切回台股時，台股仍有對應頁；切到美股則壓回 /us
  const usHref = usPathWithoutRemovedFeatures(rest === "/" ? "/" : rest);

  return (
    <SegmentedLinks
      ariaLabel="市場切換"
      size={size}
      className={className}
      items={[
        { href: twHref, label: "台股", active: market === "tw" },
        { href: usHref, label: "美股", active: market === "us" },
      ]}
    />
  );
}
