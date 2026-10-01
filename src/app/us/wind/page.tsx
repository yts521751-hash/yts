"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { WindDashboard } from "@/components/wind-dashboard";
import type { WindReading } from "@/lib/wind-types";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/app-shell";
import { ActionButton } from "@/components/ui/action-button";
import { Panel } from "@/components/ui/panel";
import { ErrorState, LoadingState } from "@/components/ui/states";

type Payload = {
  spx?: WindReading;
  ndx?: WindReading;
  twse?: WindReading;
  tpex?: WindReading;
  builtAt?: string;
};

export default function UsWindPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force = false) => {
    setError(null);
    if (force) setRefreshing(true);
    try {
      const res = await fetch(`/api/us/wind${force ? "?force=1" : ""}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!json.ok || !(json.spx || json.twse) || !(json.ndx || json.tpex)) {
        throw new Error(json.error || "美股風度載入失敗");
      }
      setData({
        spx: json.spx || json.twse,
        ndx: json.ndx || json.tpex,
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

  const primary = data?.spx;
  const secondary = data?.ndx;

  return (
    <AppShell
      market="us"
      width="default"
      back={{ href: "/us", label: "回美股資金流" }}
      eyebrow="US WIND GAUGE"
      title="美股風度儀表板"
      description="風力度 ＝ 指數相對均線的結構清楚程度（不是乖離率大小）；右上角標籤是站上／跌破結構。"
      meta={
        data?.builtAt
          ? `S&P 500（^GSPC）與 Nasdaq（^IXIC）· 更新 ${new Date(data.builtAt).toLocaleString("zh-TW", { hour12: false })}`
          : "S&P 500（^GSPC）與 Nasdaq（^IXIC）"
      }
      footerNote="資料來源：Yahoo Finance（^GSPC／^IXIC）"
      actions={
        <ActionButton onClick={() => void load(true)} disabled={refreshing}>
          <RefreshCw
            className={cn("size-3.5", refreshing && "animate-spin")}
            aria-hidden
          />
          更新
        </ActionButton>
      }
    >
      {loading && !data ? (
        <Panel>
          <LoadingState label="載入美股風度…" />
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
      ) : primary && secondary ? (
        <WindDashboard readings={[primary, secondary]} />
      ) : null}
    </AppShell>
  );
}
