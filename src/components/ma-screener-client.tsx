"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";
import {
  CLIENT_CACHE_KEYS,
  readClientCache,
  writeClientCache,
} from "@/lib/client-cache";
import { formatYi, formatYiSigned, signedClass } from "@/lib/format";
import type { MaScreenerPayload, MaScreenerRow } from "@/lib/ma-screener-types";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/app-shell";
import { Panel } from "@/components/ui/panel";
import { ActionButton } from "@/components/ui/action-button";
import { Amount } from "@/components/ui/amount";
import { SortChip, SortHeaderButton, type SortState } from "@/components/ui/chip";
import {
  EmptyState,
  NoticeBar,
  SkeletonRows,
} from "@/components/ui/states";

type Filter = "all" | "ma5" | "ma10" | "all2";
type SortKey = "score" | "amt5" | "flow5" | "bias10" | "close";

function isAbove(close: number, ma: number | null | undefined) {
  return ma != null && close >= ma;
}

function rowFlags(row: MaScreenerRow) {
  const above5 = isAbove(row.close, row.ma5);
  const above10 = isAbove(row.close, row.ma10);
  return {
    above5,
    above10,
    aboveAll: above5 && above10,
    aboveCount: Number(above5) + Number(above10),
  };
}

function sortScore(row: MaScreenerRow) {
  const f = rowFlags(row);
  return Number(f.aboveAll) * 8 + Number(f.above10) * 2 + Number(f.above5);
}

function sortValue(row: MaScreenerRow, key: SortKey) {
  if (key === "amt5") return row.amt5 ?? 0;
  if (key === "flow5") return row.flow5 ?? 0;
  if (key === "bias10") return row.bias10 ?? -999;
  if (key === "close") return row.close;
  return sortScore(row);
}

const FILTERS: Array<{ id: Filter; label: string; hint: string }> = [
  { id: "all", label: "全部產業", hint: "依站上均線數排序" },
  { id: "all2", label: "兩線之上", hint: "同時站上 MA5／10" },
  { id: "ma5", label: "站上五日", hint: "收盤 ≥ MA5" },
  { id: "ma10", label: "站上十日", hint: "收盤 ≥ MA10" },
];

const SORTS: Array<{ id: SortKey; label: string }> = [
  { id: "score", label: "站上強度" },
  { id: "amt5", label: "5日成交" },
  { id: "flow5", label: "5日淨流入" },
  { id: "bias10", label: "乖離10" },
];

function Bias({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground/60">—</span>;
  const up = value >= 0;
  return (
    <span className={up ? "text-[var(--mk-up)]" : "text-[var(--mk-down)]"}>
      {up ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}

function Flag({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-[0.6875rem] font-semibold",
        on
          ? "bg-[var(--mk-surge-bg)] text-[var(--mk-surge)]"
          : "bg-sunken text-muted-foreground/55",
      )}
      title={on ? `站上 MA${label}` : `未站上 MA${label}`}
    >
      {label}
    </span>
  );
}

function sectorHref(id: string) {
  return `/sectors/${encodeURIComponent(id)}?from=ma`;
}

function RowCard({ row }: { row: MaScreenerRow }) {
  const flags = rowFlags(row);
  return (
    <Link
      href={sectorHref(row.id)}
      className="surface block p-3 transition-colors hover:border-line-strong"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[0.9375rem] font-medium">{row.name}</div>
          <div className="t-meta mt-0.5">
            收盤 <span className="num">{row.close.toFixed(2)}</span> · 站上{" "}
            <span className="num">{flags.aboveCount}/2</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Flag on={flags.above5} label="5" />
          <Flag on={flags.above10} label="10" />
          <ChevronRight
            className="size-4 text-muted-foreground/60"
            aria-hidden
          />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="surface-sunken px-2.5 py-2">
          <div className="t-kicker">5 日成交</div>
          <Amount
            text={formatYi(row.amt5 ?? 0)}
            className="mt-1 block text-sm font-semibold"
          />
        </div>
        <div className="surface-sunken px-2.5 py-2">
          <div className="t-kicker">5 日淨流入</div>
          <Amount
            text={formatYiSigned(row.flow5 ?? 0)}
            className={cn(
              "mt-1 block text-sm font-semibold",
              signedClass(row.flow5 ?? 0),
            )}
          />
        </div>
      </div>
    </Link>
  );
}

function seedFrom(initial: MaScreenerPayload | null): {
  data: MaScreenerPayload | null;
  fromCache: boolean;
} {
  const usable = (p: MaScreenerPayload | null) => {
    if (!p?.rows?.length) return false;
    const noMa10 = p.rows.filter((r) => r.ma10 == null).length;
    return noMa10 < Math.ceil(p.rows.length * 0.5);
  };
  if (usable(initial)) return { data: initial, fromCache: false };
  if (typeof window === "undefined") return { data: null, fromCache: false };
  const cached = readClientCache<MaScreenerPayload>(CLIENT_CACHE_KEYS.ma);
  if (usable(cached)) return { data: cached, fromCache: true };
  return { data: usable(initial) ? initial : null, fromCache: false };
}

export function MaScreenerClient({
  initial,
}: {
  initial: MaScreenerPayload | null;
}) {
  const seeded = seedFrom(initial);
  const [data, setData] = useState<MaScreenerPayload | null>(() => seeded.data);
  const [loading, setLoading] = useState(() => !seeded.data?.rows?.length);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [asc, setAsc] = useState(false);
  const [fromCache, setFromCache] = useState(() => seeded.fromCache);

  const hasRowsRef = useRef(Boolean(seeded.data?.rows?.length));
  useEffect(() => {
    hasRowsRef.current = Boolean(data?.rows?.length);
  }, [data?.rows?.length]);

  const load = useCallback(async (force = false) => {
    setError(null);
    if (force) setRefreshing(true);
    try {
      const res = await fetch(`/api/ma-screener${force ? "?force=1" : ""}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as MaScreenerPayload & {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || json.ok === false) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      if (json.rows?.length) {
        setData(json);
        setFromCache(false);
        writeClientCache(CLIENT_CACHE_KEYS.ma, json);
        hasRowsRef.current = true;
      } else if (!hasRowsRef.current) {
        setData(json);
      }
    } catch (e) {
      if (!hasRowsRef.current) {
        setError(e instanceof Error ? e.message : "載入失敗");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (seeded.data?.rows?.length) {
      setLoading(false);
      // 有可用快照就略過自動重抓；手動「重新掃描」才 force
      return;
    }
    void load(false);
  }, [load, seeded.data?.rows?.length]);

  const filtered = useMemo(() => {
    const rows = data?.rows ?? [];
    let list = rows;
    if (filter === "ma5") list = rows.filter((r) => rowFlags(r).above5);
    else if (filter === "ma10") list = rows.filter((r) => rowFlags(r).above10);
    else if (filter === "all2") list = rows.filter((r) => rowFlags(r).aboveAll);

    return [...list].sort((a, b) => {
      const d = sortValue(a, sortKey) - sortValue(b, sortKey);
      if (d !== 0) return asc ? d : -d;
      return (b.amt5 ?? 0) - (a.amt5 ?? 0);
    });
  }, [data, filter, sortKey, asc]);

  const summary = useMemo(() => {
    const rows = data?.rows ?? [];
    let ma5 = 0;
    let ma10 = 0;
    let all2 = 0;
    for (const r of rows) {
      const f = rowFlags(r);
      if (f.above5) ma5++;
      if (f.above10) ma10++;
      if (f.aboveAll) all2++;
    }
    return { ma5, ma10, all2, total: rows.length };
  }, [data?.rows]);

  const shortBars = useMemo(
    () => (data?.rows ?? []).filter((r) => (r.bars ?? 0) < 10).length,
    [data?.rows],
  );

  const activeHint = FILTERS.find((f) => f.id === filter)?.hint ?? "";

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setAsc((v) => !v);
    else {
      setSortKey(key);
      setAsc(false);
    }
  };

  const sortState = (key: SortKey): SortState =>
    sortKey === key ? (asc ? "asc" : "desc") : "none";

  const filterCount = (id: Filter) =>
    id === "all"
      ? summary.total
      : id === "ma5"
        ? summary.ma5
        : id === "ma10"
          ? summary.ma10
          : summary.all2;

  return (
    <AppShell
      market="tw"
      width="default"
      back={{ href: "/", label: "回資金流" }}
      eyebrow="MA SCREENER"
      title="產業均線掃描"
      description="找出產業指數收盤站上五日、十日線的族群，並顯示近五日成交與淨流入。"
      meta={
        <>
          資料來源：臺灣證券交易所、證券櫃檯買賣中心公開資料
          {data?.asOf ? ` · 資料日 ${data.asOf}` : ""}
          {data?.builtAt
            ? ` · 更新 ${new Date(data.builtAt).toLocaleString("zh-TW", { hour12: false })}`
            : ""}
          {fromCache ? " · 本機快取" : ""}
        </>
      }
      actions={
        <ActionButton
          onClick={() => void load(true)}
          disabled={loading || refreshing}
        >
          <RefreshCw
            className={cn("size-3.5", (loading || refreshing) && "animate-spin")}
            aria-hidden
          />
          重新掃描
        </ActionButton>
      }
      notice={
        error ? (
          <NoticeBar tone="warn">{error}</NoticeBar>
        ) : shortBars > 0 ? (
          <NoticeBar tone="warn">
            有 {shortBars}{" "}
            個產業日線不足 10 根，兩線可能暫時無法判定；請按「重新掃描」補建報價歷史。
          </NoticeBar>
        ) : null
      }
    >
      <Panel padded>
        <p className="t-kicker">篩選</p>
        <div className="scroll-x mt-2 flex gap-2 pb-1">
          {FILTERS.map((f) => {
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(f.id)}
                className={cn(
                  "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[0.8125rem] font-medium transition-colors",
                  active
                    ? "border-transparent bg-[var(--mk-anchor)] text-[var(--mk-anchor-fg)]"
                    : "border-line bg-sunken text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
                <span className={cn("num", active ? "opacity-80" : "opacity-60")}>
                  {filterCount(f.id)}
                </span>
              </button>
            );
          })}
        </div>
        <p className="t-meta mt-1.5">{activeHint}</p>

        <p className="t-kicker mt-4">排序</p>
        <div className="scroll-x mt-2 flex gap-2 pb-1">
          {SORTS.map((s) => (
            <SortChip
              key={s.id}
              label={s.label}
              state={sortState(s.id)}
              onClick={() => toggleSort(s.id)}
            />
          ))}
        </div>
      </Panel>

      {loading && !data?.rows?.length ? (
        <SkeletonRows rows={6} height="h-28" />
      ) : filtered.length === 0 ? (
        <Panel>
          <EmptyState
            title={`目前沒有符合「${FILTERS.find((f) => f.id === filter)?.label}」的產業`}
            description={
              shortBars > 0 || (data?.rows ?? []).some((r) => r.ma10 == null)
                ? "日線尚未就緒，請按「重新掃描」。"
                : undefined
            }
          />
        </Panel>
      ) : (
        <>
          <div className="grid gap-3 md:hidden">
            {filtered.map((row) => (
              <RowCard key={row.id} row={row} />
            ))}
          </div>

          <Panel className="hidden overflow-hidden md:block">
            <div className="scroll-x">
              <table className="data-table min-w-[860px]">
                <thead>
                  <tr>
                    <th>產業</th>
                    <th className="cell-num">
                      <SortHeaderButton
                        state={sortState("close")}
                        onClick={() => toggleSort("close")}
                      >
                        收盤
                      </SortHeaderButton>
                    </th>
                    <th>站上</th>
                    <th className="cell-num">
                      <SortHeaderButton
                        state={sortState("amt5")}
                        onClick={() => toggleSort("amt5")}
                      >
                        5 日成交
                      </SortHeaderButton>
                    </th>
                    <th className="cell-num">
                      <SortHeaderButton
                        state={sortState("flow5")}
                        onClick={() => toggleSort("flow5")}
                      >
                        5 日淨流入
                      </SortHeaderButton>
                    </th>
                    <th className="cell-num">乖離 5</th>
                    <th className="cell-num">
                      <SortHeaderButton
                        state={sortState("bias10")}
                        onClick={() => toggleSort("bias10")}
                      >
                        乖離 10
                      </SortHeaderButton>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => {
                    const flags = rowFlags(row);
                    return (
                      <tr key={row.id}>
                        <td>
                          <Link
                            href={sectorHref(row.id)}
                            className="font-medium transition-colors hover:text-[var(--mk-anchor)]"
                          >
                            {row.name}
                          </Link>
                        </td>
                        <td className="cell-num text-muted-foreground">
                          {row.close.toFixed(2)}
                        </td>
                        <td>
                          <div className="flex gap-1">
                            <Flag on={flags.above5} label="5" />
                            <Flag on={flags.above10} label="10" />
                          </div>
                        </td>
                        <td className="cell-num">
                          <Amount text={formatYi(row.amt5 ?? 0)} />
                        </td>
                        <td
                          className={cn(
                            "cell-num font-semibold",
                            signedClass(row.flow5 ?? 0),
                          )}
                        >
                          <Amount text={formatYiSigned(row.flow5 ?? 0)} />
                        </td>
                        <td className="cell-num">
                          <Bias value={row.bias5} />
                        </td>
                        <td className="cell-num">
                          <Bias value={row.bias10} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </AppShell>
  );
}
