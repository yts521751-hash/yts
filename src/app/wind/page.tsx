"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { WindDashboard } from "@/components/wind-dashboard";
import type { WindPayload } from "@/lib/wind-types";
import { cn } from "@/lib/utils";

export default function WindPage() {
  const [data, setData] = useState<WindPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force = false) => {
    setError(null);
    if (force) setRefreshing(true);
    try {
      const res = await fetch(`/api/wind${force ? "?force=1" : ""}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!json.ok || !json.twse || !json.tpex) {
        throw new Error(json.error || "風度資料載入失敗");
      }
      setData({
        twse: json.twse,
        tpex: json.tpex,
        builtAt: json.builtAt,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入失敗");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  return (
    <div className="relative min-h-full flex-1 pb-20 md:pb-6">
      <div className="pulse-atmosphere pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative z-10 mx-auto max-w-[1100px] px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            回資金流
          </Link>
          <button
            type="button"
            onClick={() => void load(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-xs font-medium transition hover:bg-muted/60"
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
            更新
          </button>
        </div>

        {loading && !data ? (
          <p className="py-16 text-center text-sm text-muted-foreground">載入中…</p>
        ) : error && !data ? (
          <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-6 text-sm">
            {error}
          </p>
        ) : data ? (
          <WindDashboard twse={data.twse} tpex={data.tpex} builtAt={data.builtAt} />
        ) : null}

        <p className="mt-8 text-center text-[11px] text-muted-foreground">
          資料來源：臺灣證券交易所、證券櫃檯買賣中心公開資料
        </p>
      </div>
    </div>
  );
}
