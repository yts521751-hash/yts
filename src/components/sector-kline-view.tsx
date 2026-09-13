"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SectorKlineChart } from "@/components/sector-kline-chart";
import type { SectorCandle } from "@/lib/types";

type Payload = {
  ok?: boolean;
  sectorId?: string;
  sectorName?: string;
  candles?: SectorCandle[];
  error?: string;
};

type Props = {
  sectorId: string;
  initialName?: string;
  initialCandles?: SectorCandle[];
  initialMembers?: { code: string; name: string }[];
  initialError?: string | null;
};

export function SectorKlineView({
  sectorId,
  initialName,
  initialCandles = [],
  initialMembers = [],
  initialError = null,
}: Props) {
  const [name, setName] = useState(initialName || sectorId);
  const [candles, setCandles] = useState(initialCandles);
  const [members, setMembers] = useState(initialMembers);
  const [error, setError] = useState<string | null>(initialError);
  const [loading, setLoading] = useState(initialCandles.length === 0);

  const load = useCallback(
    async (force = false) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/sector/${encodeURIComponent(sectorId)}?days=80${force ? "&force=1" : ""}`,
          { cache: "no-store" },
        );
        const data = (await res.json()) as Payload & {
          members?: { code: string; name: string }[];
        };
        if (data.sectorName) setName(data.sectorName);
        if (data.members?.length) setMembers(data.members);
        if (data.candles?.length) {
          setCandles(data.candles);
          setError(null);
        } else {
          setError(
            data.error ||
              "產業 K 線資料不足。請回首頁按「觸發背景更新」暖機日行情後再試。",
          );
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "載入失敗");
      } finally {
        setLoading(false);
      }
    },
    [sectorId],
  );

  useEffect(() => {
    if (initialCandles.length > 0) {
      setLoading(false);
      return;
    }
    void load(false);
  }, [initialCandles.length, load]);

  return (
    <div className="relative min-h-full flex-1">
      <div className="studio-atmosphere pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative z-10 mx-auto max-w-[1100px] px-4 py-8 sm:px-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          回排行榜
        </Link>
        <h1 className="mt-4 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
          {name}
        </h1>

        <div className="mt-6 rounded-2xl border border-border/60 bg-[var(--panel)]/80 p-4 backdrop-blur-sm">
          {loading ? (
            <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
              載入產業 K 線…
            </div>
          ) : candles.length ? (
            <SectorKlineChart candles={candles} />
          ) : (
            <div className="flex h-72 flex-col items-center justify-center gap-3 px-4 text-center text-sm text-muted-foreground">
              <p>{error || "尚無日線資料"}</p>
              <button
                type="button"
                onClick={() => void load(true)}
                className="border border-border px-3 py-1.5 text-xs text-foreground transition hover:bg-muted/50"
              >
                再試一次
              </button>
            </div>
          )}
        </div>

        {members.length > 0 && (
          <div className="mt-4 rounded-2xl border border-border/50 bg-[var(--panel)]/60 p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">成分股</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {[...members]
                .sort((a, b) => a.code.localeCompare(b.code))
                .map((m) => (
                  <li
                    key={m.code}
                    className="rounded-lg bg-muted/50 px-2.5 py-1 text-xs tabular-nums"
                  >
                    {m.code} {m.name}
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
