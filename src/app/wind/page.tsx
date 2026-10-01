"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { WindDashboard } from "@/components/wind-dashboard";
import {
  CLIENT_CACHE_KEYS,
  readClientCache,
  writeClientCache,
} from "@/lib/client-cache";
import type { WindPayload } from "@/lib/wind-types";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/app-shell";
import { ActionButton } from "@/components/ui/action-button";
import { Panel } from "@/components/ui/panel";
import { ErrorState, LoadingState, NoticeBar } from "@/components/ui/states";

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
    <AppShell
      market="tw"
      width="default"
      back={{ href: "/", label: "回資金流" }}
      eyebrow="WIND GAUGE"
      title="風度儀表板"
      description="風力度 ＝ 指數相對均線的結構清楚程度（不是乖離率大小）；右上角標籤是站上／跌破結構。"
      meta={
        data?.builtAt
          ? `更新 ${new Date(data.builtAt).toLocaleString("zh-TW", { hour12: false })}`
          : undefined
      }
      actions={
        <ActionButton onClick={() => void load(true)} disabled={refreshing}>
          <RefreshCw
            className={cn("size-3.5", refreshing && "animate-spin")}
            aria-hidden
          />
          更新
        </ActionButton>
      }
      notice={
        (fromCache || syncing) && data ? (
          <NoticeBar>
            {fromCache
              ? "已先顯示本機快取，背景同步風度中…"
              : "背景重建風度中，稍後會自動更新"}
          </NoticeBar>
        ) : null
      }
    >
      {loading && !data ? (
        <Panel>
          <LoadingState label="載入風度…" />
        </Panel>
      ) : error && !data ? (
        <Panel>
          <ErrorState
            description={error}
            action={
              <ActionButton size="sm" onClick={() => void load(true)}>
                再試一次
              </ActionButton>
            }
          />
        </Panel>
      ) : data ? (
        <WindDashboard readings={[data.twse, data.tpex]} />
      ) : null}
    </AppShell>
  );
}
