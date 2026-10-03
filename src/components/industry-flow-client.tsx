"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, RefreshCw } from "lucide-react";
import {
  CLIENT_CACHE_KEYS,
  readClientCache,
  writeClientCache,
} from "@/lib/client-cache";
import {
  formatMarketYi,
  formatMarketYiSigned,
  formatPct,
  signedClass,
} from "@/lib/format";
import type {
  IndustryFlowPayload,
  IndustryFlowRow,
} from "@/lib/build-industry-flow";
import type { IndustryMegaGroup } from "@/lib/industry-taxonomy";
import { STATUS_META } from "@/lib/types";
import { statusFromFlow } from "@/lib/money-flow";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/app-shell";
import { COLUMN_TIPS, ColumnTip } from "@/components/column-tip";
import { ActionButton } from "@/components/ui/action-button";
import { Amount } from "@/components/ui/amount";
import {
  Chip,
  RankSlot,
  SortChip,
  SortHeaderButton,
  StatusPill,
  type SortState,
} from "@/components/ui/chip";
import { Panel } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { ErrorState, LoadingState, NoticeBar } from "@/components/ui/states";

type RankPeriod = "day" | "d3" | "d5";
type ScopeFilter = "industry" | "theme" | "all";
type MegaFilter = "all" | IndustryMegaGroup;
type SortKey = "flow" | "amt" | "insti" | "accel";

const PERIOD_ITEMS = [
  { value: "day" as RankPeriod, label: "當天" },
  { value: "d3" as RankPeriod, label: "3 天" },
  { value: "d5" as RankPeriod, label: "5 天" },
];

const SCOPE_ITEMS = [
  { value: "industry" as ScopeFilter, label: "官方產業" },
  { value: "theme" as ScopeFilter, label: "題材" },
  { value: "all" as ScopeFilter, label: "全部" },
];

const MEGA_ITEMS = [
  { value: "all" as MegaFilter, label: "全部" },
  { value: "電子" as MegaFilter, label: "電子" },
  { value: "金融" as MegaFilter, label: "金融" },
  { value: "傳產" as MegaFilter, label: "傳產" },
];

function periodFlow(r: IndustryFlowRow, period: RankPeriod) {
  if (period === "d3") return r.d3Flow;
  if (period === "d5") return r.d5Flow;
  return r.dayFlow;
}

function periodAmt(r: IndustryFlowRow, period: RankPeriod) {
  if (period === "d3") return r.d3;
  if (period === "d5") return r.d5;
  return r.dayAmt;
}

function periodInsti(r: IndustryFlowRow, period: RankPeriod) {
  if (period === "d3") return r.d3InstiYi;
  if (period === "d5") return r.d5InstiYi;
  return r.dayInstiYi;
}

function sortValue(r: IndustryFlowRow, key: SortKey, period: RankPeriod) {
  if (key === "amt") return periodAmt(r, period);
  if (key === "insti") return periodInsti(r, period);
  if (key === "accel") return r.accel;
  return periodFlow(r, period);
}

export function IndustryFlowClient({
  initial = null,
}: {
  initial?: IndustryFlowPayload | null;
}) {
  const [data, setData] = useState<IndustryFlowPayload | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!initial?.rows?.length);
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<RankPeriod>("day");
  const [scope, setScope] = useState<ScopeFilter>("industry");
  const [mega, setMega] = useState<MegaFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("flow");
  const [asc, setAsc] = useState(false);
  const [direction, setDirection] = useState<"all" | "in" | "out">("all");

  useEffect(() => {
    if (initial?.rows?.length) {
      writeClientCache(CLIENT_CACHE_KEYS.industryFlow, initial);
      return;
    }
    const cached = readClientCache<IndustryFlowPayload>(
      CLIENT_CACHE_KEYS.industryFlow,
    );
    if (cached?.rows?.length) {
      setData(cached);
      setLoading(false);
    }
  }, [initial]);

  const load = useCallback(async (force = false) => {
    setError(null);
    if (force) setRefreshing(true);
    else if (!data?.rows?.length) setLoading(true);
    try {
      const res = await fetch(
        `/api/industry-flow${force ? "?force=1" : ""}`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as IndustryFlowPayload & {
        ok?: boolean;
        error?: string;
      };
      if (!json.ok || !json.rows?.length) {
        throw new Error(json.error || "產業流資料載入失敗");
      }
      const next: IndustryFlowPayload = {
        brief: json.brief,
        rows: json.rows,
        tradingDays: json.tradingDays,
        source: json.source,
        builtAt: json.builtAt,
        formula: json.formula,
        metricNote: json.metricNote,
        taxonomy: json.taxonomy,
      };
      setData(next);
      writeClientCache(CLIENT_CACHE_KEYS.industryFlow, next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入失敗");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [data?.rows?.length]);

  useEffect(() => {
    if (!data?.rows?.length) void load(false);
  }, [data?.rows?.length, load]);

  const rows = useMemo(() => {
    const list = (data?.rows ?? []).filter((r) => {
      const kind = r.kind ?? "theme";
      if (scope === "industry" && kind !== "industry") return false;
      if (scope === "theme" && kind === "industry") return false;
      if (scope === "industry" && mega !== "all" && r.megaGroup !== mega) {
        return false;
      }
      const flow = periodFlow(r, period);
      if (direction === "in" && flow <= 0) return false;
      if (direction === "out" && flow >= 0) return false;
      return true;
    });
    return [...list].sort((a, b) => {
      let diff: number;
      if (direction === "out" && (sortKey === "flow" || sortKey === "insti")) {
        // 流出/賣超排行：預設最負（流出/賣超最多）排第 1
        diff = sortValue(b, sortKey, period) - sortValue(a, sortKey, period);
      } else {
        diff = sortValue(a, sortKey, period) - sortValue(b, sortKey, period);
      }
      return asc ? diff : -diff;
    });
  }, [data?.rows, scope, mega, period, sortKey, asc, direction]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setAsc((v) => !v);
    else {
      setSortKey(key);
      setAsc(false);
    }
  };

  const sortState = (key: SortKey): SortState =>
    sortKey === key ? (asc ? "asc" : "desc") : "none";

  const columns = useMemo(
    () => [
      {
        key: "flow" as const,
        label:
          period === "day" ? "淨流" : period === "d3" ? "3 日淨流" : "5 日淨流",
        tip:
          period === "day"
            ? "當日全成分混合金流＝80%×(成交×漲跌軟訊號)＋20%×法人淨買賣超金額。非 toAlpha 成交占比偏差。"
            : period === "d3"
              ? "近 3 日全成分混合金流合計（億元）。"
              : "近 5 日全成分混合金流合計（億元）。",
      },
      {
        key: "amt" as const,
        label:
          period === "day" ? "成交" : period === "d3" ? "3 日成交" : "5 日成交",
        tip:
          period === "day"
            ? COLUMN_TIPS.amt
            : period === "d3"
              ? COLUMN_TIPS.amt3
              : COLUMN_TIPS.amt5,
      },
      {
        key: "insti" as const,
        label:
          period === "day"
            ? "法人買賣超"
            : period === "d3"
              ? "3 日法人"
              : "5 日法人",
        tip: "三大法人（外資＋投信＋自營商）買賣超金額合計（億元）＝買賣超股數×收盤價加總。",
      },
      {
        key: "accel" as const,
        label: "加速度",
        tip: COLUMN_TIPS.accel,
      },
    ],
    [period],
  );

  const inflowCount = rows.filter((r) => periodFlow(r, period) > 0).length;
  const outflowCount = rows.filter((r) => periodFlow(r, period) < 0).length;

  return (
    <AppShell
      market="tw"
      width="wide"
      back={{ href: "/", label: "回資金流" }}
      eyebrow="INDUSTRY FLOW · EOD"
      title="產業資金流"
      description="盤後官方產業全成分加總的混合金流排行（當天／3 天／5 天）。口徑與首頁金流相同，不是 toAlpha 成交占比偏差。"
      meta={
        data
          ? `資料日 ${data.brief.date} · ${data.metricNote}`
          : "讀取盤後日檔…"
      }
      actions={
        <ActionButton onClick={() => void load(true)} disabled={refreshing}>
          <RefreshCw
            className={cn("size-3.5", refreshing && "animate-spin")}
            aria-hidden
          />
          重新整理
        </ActionButton>
      }
      notice={
        error && data?.rows?.length ? (
          <NoticeBar tone="warn">提醒：{error}</NoticeBar>
        ) : null
      }
    >
      {loading && !data?.rows?.length ? (
        <Panel>
          <LoadingState label="載入產業資金流…" />
        </Panel>
      ) : error && !data?.rows?.length ? (
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
      ) : (
        <>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                ariaLabel="時間窗"
                size="sm"
                items={PERIOD_ITEMS}
                value={period}
                onChange={setPeriod}
              />
              <Segmented
                ariaLabel="分類範圍"
                size="sm"
                items={SCOPE_ITEMS}
                value={scope}
                onChange={(v) => {
                  setScope(v);
                  if (v !== "industry") setMega("all");
                }}
              />
              <Segmented
                ariaLabel="流入流出"
                size="sm"
                items={[
                  { value: "all" as const, label: "全部" },
                  { value: "in" as const, label: "流入" },
                  { value: "out" as const, label: "流出" },
                ]}
                value={direction}
                onChange={setDirection}
              />
            </div>
            {scope === "industry" ? (
              <div className="flex flex-wrap items-center gap-2">
                <Segmented
                  ariaLabel="大板塊"
                  size="sm"
                  items={MEGA_ITEMS}
                  value={mega}
                  onChange={setMega}
                />
                <p className="t-kicker">
                  流入 {inflowCount} · 流出 {outflowCount} · 共 {rows.length} 列
                </p>
              </div>
            ) : (
              <p className="t-kicker">
                流入 {inflowCount} · 流出 {outflowCount} · 共 {rows.length} 列
                {scope === "theme"
                  ? " · 題材為人工供應鏈名單（接近 CMoney 題材，非官方產業）"
                  : ""}
              </p>
            )}
          </div>

          <Panel className="overflow-hidden">
            <div className="scroll-x flex gap-2 border-b border-line px-3 py-2 md:hidden">
              {columns.map((col) => (
                <SortChip
                  key={col.key}
                  label={col.label}
                  state={sortState(col.key)}
                  onClick={() => toggleSort(col.key)}
                />
              ))}
            </div>

            <div className="md:hidden">
              <ul className="divide-y divide-line">
                {rows.map((r, i) => {
                  const flow = periodFlow(r, period);
                  const amt = periodAmt(r, period);
                  const insti = periodInsti(r, period);
                  const liveStatus = statusFromFlow(r.d5Flow ?? 0, r.accel ?? 0);
                  const meta = STATUS_META[liveStatus];
                  const href = `/sectors/${encodeURIComponent(r.id)}?from=industry-flow`;
                  return (
                    <li key={r.id}>
                      <Link
                        href={href}
                        className="relative flex min-h-[4.5rem] items-center gap-3 py-3 pr-3 pl-4 transition-colors active:bg-sunken"
                      >
                        <span
                          className="absolute inset-y-2 left-0 w-[3px] rounded-full"
                          style={{ background: meta.color }}
                          aria-hidden
                        />
                        <RankSlot rank={i + 1} emphasis />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate text-[0.9375rem] font-medium">
                              {r.name}
                            </span>
                            <StatusPill
                              label={meta.label}
                              color={meta.color}
                              background={meta.bg}
                            />
                            {r.kind === "industry" && r.megaGroup ? (
                              <Chip>{r.megaGroup}</Chip>
                            ) : (
                              <Chip>題材</Chip>
                            )}
                          </span>
                          <span className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                            <span>
                              成交{" "}
                              <Amount
                                text={formatMarketYi(amt)}
                                className="text-foreground/75"
                              />
                            </span>
                            <span>
                              法人{" "}
                              <Amount
                                text={formatMarketYiSigned(insti)}
                                className={signedClass(insti)}
                              />
                            </span>
                            <span>{r.memberCount} 檔</span>
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span
                            className={cn(
                              "num block text-[0.9375rem] font-semibold",
                              signedClass(flow),
                            )}
                          >
                            <Amount text={formatMarketYiSigned(flow)} />
                          </span>
                          <span className="t-kicker block">淨流</span>
                        </span>
                        <ChevronRight
                          className="size-4 shrink-0 text-muted-foreground/60"
                          aria-hidden
                        />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="scroll-x hidden md:block">
              <table className="data-table min-w-[880px]">
                <thead>
                  <tr>
                    <th className="w-10 text-right">#</th>
                    <th>產業／題材</th>
                    {columns.map((col) => (
                      <th key={col.key} className="cell-num">
                        <SortHeaderButton
                          state={sortState(col.key)}
                          onClick={() => toggleSort(col.key)}
                        >
                          <ColumnTip tip={col.tip}>{col.label}</ColumnTip>
                        </SortHeaderButton>
                      </th>
                    ))}
                    <th className="cell-num">
                      <ColumnTip tip={COLUMN_TIPS.priceChange20d}>
                        20 日漲幅
                      </ColumnTip>
                    </th>
                    <th className="text-right">
                      <ColumnTip tip="納入加總的上市櫃成分股總檔數（全成分）">
                        成分
                      </ColumnTip>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const flow = periodFlow(r, period);
                    const amt = periodAmt(r, period);
                    const insti = periodInsti(r, period);
                    const liveStatus = statusFromFlow(
                      r.d5Flow ?? 0,
                      r.accel ?? 0,
                    );
                    const meta = STATUS_META[liveStatus];
                    const href = `/sectors/${encodeURIComponent(r.id)}?from=industry-flow`;
                    return (
                      <tr key={r.id}>
                        <td className="num w-10 text-right text-muted-foreground">
                          {i + 1}
                        </td>
                        <td>
                          <Link
                            href={href}
                            className="flex min-w-0 flex-col gap-1 hover:text-[var(--mk-anchor)]"
                          >
                            <span className="truncate font-medium">
                              {r.name}
                            </span>
                            <span className="flex flex-wrap items-center gap-1">
                              <StatusPill
                                label={meta.label}
                                color={meta.color}
                                background={meta.bg}
                              />
                              {r.kind === "industry" && r.megaGroup ? (
                                <Chip>{r.megaGroup}</Chip>
                              ) : (
                                <Chip>題材</Chip>
                              )}
                              {r.fullRollup ? (
                                <Chip tone="outline">全成分</Chip>
                              ) : null}
                            </span>
                          </Link>
                        </td>
                        <td
                          className={cn(
                            "cell-num font-semibold",
                            signedClass(flow),
                          )}
                        >
                          <Amount text={formatMarketYiSigned(flow)} />
                        </td>
                        <td className="cell-num">
                          <Amount text={formatMarketYi(amt)} />
                        </td>
                        <td className={cn("cell-num", signedClass(insti))}>
                          <Amount text={formatMarketYiSigned(insti)} />
                        </td>
                        <td className={cn("cell-num", signedClass(r.accel))}>
                          <Amount text={formatMarketYiSigned(r.accel)} />
                        </td>
                        <td
                          className={cn(
                            "cell-num",
                            signedClass(r.priceChange20d),
                          )}
                        >
                          {formatPct(r.priceChange20d)}
                        </td>
                        <td className="num text-right text-muted-foreground">
                          {r.memberCount}
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
