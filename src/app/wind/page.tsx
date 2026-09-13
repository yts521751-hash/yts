"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { WindDashboard } from "@/components/wind-dashboard";
import {
  CLIENT_CACHE_KEYS,
  readClientCache,
  writeClientCache,
} from "@/lib/client-cache";
import type { WindPayload } from "@/lib/wind-types";
import { cn } from "@/lib/utils";

export default function WindPage() {
  const [data, setData] = useState<WindPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const cached = readClientCache<WindPayload>(CLIENT_CACHE_KEYS.wind);
    if (cached?.twse && cached?.tpex) {
      setData(cached);
      setFromCache(true);
      setLoading(false);
      setSyncing(true);
    }
  }, []);

  const load = useCallback(async (force = false) => {
    setError(null);
    if (force) setRefreshing(true);
    setSyncing(true);
    try {
      const res = await fetch(`/api/wind${force ? "?force=1" : ""}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!json.ok || !json.twse || !json.tpex) {
        throw new Error(json.error || "風度資料載入失敗");
      }
      const next: WindPayload = {
        twse: json.twse,
        tpex: json.tpex,
        builtAt: json.builtAt,
      };
      setData(next);
      setFromCache(false);
      setSyncing(Boolean(json.syncing || json.rebuild?.started));
      writeClientCache(CLIENT_CACHE_KEYS.wind, next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入失敗");
      setSyncing(false);
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
      <div className="studio-atmosphere pointer-events-none absolute inset-0" aria-hidden />
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

        {(fromCache || syncing) && data ? (
          <p className="mb-3 rounded-xl border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {fromCache
              ? "已先顯示本機快取，背景同步風度中…"
              : "背景重建風度中，稍後會自動更新"}
          </p>
        ) : null}

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
