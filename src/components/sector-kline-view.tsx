"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { marketFromPath } from "@/components/market-switch";
import { SectorKlineChart } from "@/components/sector-kline-chart";
import { formatTurnoverYi } from "@/lib/format";
import type { SectorCandle } from "@/lib/types";
import { AppShell } from "@/components/app-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { ActionButton } from "@/components/ui/action-button";
import { Amount } from "@/components/ui/amount";
import { EmptyState, LoadingState } from "@/components/ui/states";

type Member = { code: string; name: string; dayAmt?: number };

type Payload = {
  ok?: boolean;
  sectorId?: string;
  sectorName?: string;
  candles?: SectorCandle[];
  members?: Member[];
  membersAsOf?: string | null;
  error?: string;
};

type Props = {
  sectorId: string;
  initialName?: string;
  initialCandles?: SectorCandle[];
  initialMembers?: Member[];
  initialMembersAsOf?: string | null;
  initialError?: string | null;
  /** 返回目標：從均線掃描進來時回 /ma */
  backHref?: string;
  backLabel?: string;
};

export function SectorKlineView({
  sectorId,
  initialName,
  initialCandles = [],
  initialMembers = [],
  initialMembersAsOf = null,
  initialError = null,
  backHref,
  backLabel,
}: Props) {
  const pathname = usePathname();
  const market = marketFromPath(pathname);
  const apiBase = market === "us" ? "/api/us" : "/api";
  const resolvedBackHref = backHref ?? (market === "us" ? "/us" : "/ma");
  const resolvedBackLabel =
    backLabel ?? (market === "us" ? "回美股資金流" : "回產業掃描");
  const [name, setName] = useState(initialName || sectorId);
  const [candles, setCandles] = useState(initialCandles);
  const [members, setMembers] = useState(initialMembers);
  const [membersAsOf, setMembersAsOf] = useState<string | null>(
    initialMembersAsOf,
  );
  const [error, setError] = useState<string | null>(initialError);
  const [loading, setLoading] = useState(initialCandles.length === 0);

  const load = useCallback(
    async (force = false) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `${apiBase}/sector/${encodeURIComponent(sectorId)}?days=80${force ? "&force=1" : ""}`,
          { cache: "no-store" },
        );
        const data = (await res.json()) as Payload;
        if (data.sectorName) setName(data.sectorName);
        if (data.members?.length) {
          setMembers(data.members);
          if (data.membersAsOf != null) setMembersAsOf(data.membersAsOf);
        }
        if (data.candles?.length) {
          setCandles(data.candles);
          setError(null);
        } else {
          setError(
            data.error ||
              "產業 K 線資料不足。請回首頁按「同步資料」暖機日行情後再試。",
          );
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "載入失敗");
      } finally {
        setLoading(false);
      }
    },
    [sectorId, apiBase],
  );

  useEffect(() => {
    if (initialCandles.length > 0) {
      setLoading(false);
      return;
    }
    void load(false);
  }, [initialCandles.length, load]);

  const sortedMembers = [...members].sort((a, b) => {
    const ta = a.dayAmt ?? 0;
    const tb = b.dayAmt ?? 0;
    if (tb !== ta) return tb - ta;
    return a.code.localeCompare(b.code);
  });

  return (
    <AppShell
      market={market}
      width="default"
      back={{ href: resolvedBackHref, label: resolvedBackLabel }}
      eyebrow="SECTOR K-LINE"
      title={name}
      description="成分股開高低收依成交金額加權合成的指數型日線（基準 100），疊 MA5／10／20／60，下方為每日流入／流出。"
    >
      <Panel padded>
        {loading ? (
          <LoadingState label="載入產業 K 線…" />
        ) : candles.length ? (
          <SectorKlineChart candles={candles} />
        ) : (
          <EmptyState
            title="尚無日線資料"
            description={error || undefined}
            action={
              <ActionButton size="sm" onClick={() => void load(true)}>
                再試一次
              </ActionButton>
            }
          />
        )}
      </Panel>

      {sortedMembers.length > 0 && (
        <Panel padded>
          <PanelHeader
            eyebrow="MEMBERS"
            title="成分股（依成交值）"
            actions={
              membersAsOf ? (
                <span className="t-meta">成交日 {membersAsOf}</span>
              ) : null
            }
          />
          <ul className="mt-3 divide-y divide-line">
            {sortedMembers.map((m) => (
              <li
                key={m.code}
                className="flex items-center justify-between gap-3 py-2 text-sm first:pt-0 last:pb-0"
              >
                <span className="min-w-0 truncate">
                  <span className="num text-muted-foreground">{m.code}</span>{" "}
                  {m.name}
                </span>
                {m.dayAmt != null && m.dayAmt > 0 ? (
                  <Amount
                    text={formatTurnoverYi(m.dayAmt)}
                    className="shrink-0 font-medium"
                  />
                ) : (
                  <span className="shrink-0 text-muted-foreground">—</span>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </AppShell>
  );
}
