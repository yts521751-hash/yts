"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SectorFlow, TideStatus } from "@/lib/types";
import { STATUS_META } from "@/lib/types";
import { cpScore } from "@/lib/mock-data";
import {
  formatHeat,
  formatMarketYi,
  formatMarketYiSigned,
  formatPct,
  signedClass,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import { COLUMN_TIPS, ColumnTip } from "@/components/column-tip";
import { statusFromFlow } from "@/lib/money-flow";
import type { MarketId } from "@/components/market-switch";
import { Segmented } from "@/components/ui/segmented";
import { Amount } from "@/components/ui/amount";
import {
  Chip,
  RankSlot,
  SortChip,
  SortHeaderButton,
  StatusPill,
  type SortState,
} from "@/components/ui/chip";

export type RankPeriod = "day" | "d3" | "d5";

type SortKey =
  | "amt"
  | "flow"
  | "accel"
  | "d20Flow"
  | "heat"
  | "priceChange20d"
  | "cp";

export type KindFilter = "all" | "industry" | "theme" | "auto";

type Props = {
  sectors: SectorFlow[];
  selectedId?: string | null;
  onSelect: (s: SectorFlow) => void;
  filter?: TideStatus | "all";
  kindFilter?: KindFilter;
  /** 與板塊明細共用的時間維度（受控） */
  period?: RankPeriod;
  onPeriodChange?: (period: RankPeriod) => void;
  market?: MarketId;
};

const KIND_LABEL: Record<Exclude<KindFilter, "all">, string> = {
  industry: "產業",
  theme: "題材",
  auto: "新興",
};

function periodAmt(s: SectorFlow, period: RankPeriod): number {
  if (period === "d3") return s.d3;
  if (period === "d5") return s.d5;
  return s.dayAmt;
}

function periodFlow(s: SectorFlow, period: RankPeriod): number {
  if (period === "d3") return s.d3Flow;
  if (period === "d5") return s.d5Flow;
  return s.dayFlow;
}

function sortValue(s: SectorFlow, key: SortKey, period: RankPeriod): number {
  if (key === "amt") return periodAmt(s, period);
  if (key === "flow") return periodFlow(s, period);
  if (key === "cp") {
    const v = cpScore(s);
    return Number.isFinite(v) ? v : -1e12;
  }
  return s[key];
}

/** 「全部」時產業大板塊會淹沒題材；配額＋關鍵概念保底，讓矽光子等進前 20 */
const PIN_THEME_IDS = new Set([
  "optical",
  "ai-server",
  "liquid-cooling",
  "hbm-memory",
  "advanced-packaging",
]);

const RANK_LIMIT = 20;
const RANK_UI_KEY = "jinliu:rank-ui:v2";

type RankUiState = { sortKey: SortKey; asc: boolean; period?: RankPeriod };

function readRankUi(): RankUiState {
  if (typeof window === "undefined") return { sortKey: "amt", asc: false };
  try {
    const raw = sessionStorage.getItem(RANK_UI_KEY);
    if (!raw) return { sortKey: "amt", asc: false };
    const parsed = JSON.parse(raw) as Partial<RankUiState>;
    const keys: SortKey[] = [
      "amt",
      "flow",
      "accel",
      "d20Flow",
      "heat",
      "priceChange20d",
      "cp",
    ];
    const sortKey = keys.includes(parsed.sortKey as SortKey)
      ? (parsed.sortKey as SortKey)
      : "amt";
    return { sortKey, asc: Boolean(parsed.asc) };
  } catch {
    return { sortKey: "amt", asc: false };
  }
}

function writeRankUi(state: RankUiState) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(RANK_UI_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

function takeTopMixed(sorted: SectorFlow[], limit = RANK_LIMIT): SectorFlow[] {
  const themes = sorted.filter((s) => (s.kind ?? "theme") !== "industry");
  const industries = sorted.filter((s) => s.kind === "industry");
  const picked = new Map<string, SectorFlow>();

  for (const s of sorted) {
    if (PIN_THEME_IDS.has(s.id)) picked.set(s.id, s);
  }
  for (const s of themes.slice(0, 12)) picked.set(s.id, s);
  for (const s of industries.slice(0, 8)) picked.set(s.id, s);
  for (const s of sorted) {
    if (picked.size >= limit) break;
    picked.set(s.id, s);
  }

  if (picked.size <= limit) {
    return sorted.filter((s) => picked.has(s.id)).slice(0, limit);
  }

  // 超額時：保底題材優先保留，其餘依原排序截斷
  const ordered = sorted.filter((s) => picked.has(s.id));
  const pinned = ordered.filter((s) => PIN_THEME_IDS.has(s.id));
  const rest = ordered.filter((s) => !PIN_THEME_IDS.has(s.id));
  const keepIds = new Set([...pinned, ...rest].slice(0, limit).map((s) => s.id));
  return sorted.filter((s) => keepIds.has(s.id)).slice(0, limit);
}

const PERIOD_ITEMS = [
  { value: "day" as RankPeriod, label: "當日" },
  { value: "d3" as RankPeriod, label: "3 日" },
  { value: "d5" as RankPeriod, label: "5 日" },
];

export function SectorRanking({
  sectors,
  selectedId,
  onSelect,
  filter = "all",
  kindFilter = "all",
  period: periodProp,
  onPeriodChange,
  market = "tw",
}: Props) {
  const [periodInner, setPeriodInner] = useState<RankPeriod>("day");
  const period = periodProp ?? periodInner;
  const setPeriod = (next: RankPeriod) => {
    if (periodProp === undefined) setPeriodInner(next);
    onPeriodChange?.(next);
  };
  const [sortKey, setSortKey] = useState<SortKey>("amt");
  const [asc, setAsc] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const prevPeriodRef = useRef(period);

  // 手機／桌面共用同一排序狀態，避免切換裝置寬度後名次看起來不一致
  useEffect(() => {
    const saved = readRankUi();
    setSortKey(saved.sortKey);
    setAsc(saved.asc);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeRankUi({ sortKey, asc });
  }, [sortKey, asc, hydrated]);

  useEffect(() => {
    if (prevPeriodRef.current === period) return;
    prevPeriodRef.current = period;
    // 切換時間維度時回到「成交額→淨流」，兩邊行為一致
    setSortKey("amt");
    setAsc(false);
  }, [period]);

  const columns = useMemo(
    () => [
      {
        key: "amt" as const,
        label:
          period === "day" ? "成交額" : period === "d3" ? "3 日成交" : "5 日成交",
        tip:
          period === "day"
            ? COLUMN_TIPS.amt
            : period === "d3"
              ? COLUMN_TIPS.amt3
              : COLUMN_TIPS.amt5,
      },
      {
        key: "flow" as const,
        label:
          period === "day"
            ? "當日淨流"
            : period === "d3"
              ? "近 3 日流"
              : "近 5 日流",
        tip:
          period === "day"
            ? COLUMN_TIPS.flow
            : period === "d3"
              ? COLUMN_TIPS.flow3
              : COLUMN_TIPS.flow5,
      },
      {
        key: "accel" as const,
        label: "加速度",
        tip: COLUMN_TIPS.accel,
      },
      {
        key: "d20Flow" as const,
        label: "近 20 日流",
        tip: COLUMN_TIPS.flow20,
      },
      {
        key: "heat" as const,
        label: "量能",
        tip: COLUMN_TIPS.heat,
      },
      {
        key: "priceChange20d" as const,
        label: "20 日漲幅",
        tip: COLUMN_TIPS.priceChange20d,
      },
      { key: "cp" as const, label: "CP", tip: COLUMN_TIPS.cp },
    ],
    [period],
  );

  const { rows, totalMatched } = useMemo(() => {
    const list = sectors.filter((s) => {
      const liveStatus = statusFromFlow(s.d5Flow ?? 0, s.accel ?? 0);
      if (filter !== "all" && liveStatus !== filter) return false;
      if (kindFilter !== "all" && (s.kind ?? "theme") !== kindFilter) return false;
      return true;
    });
    const sorted = [...list].sort((a, b) => {
      const primary =
        sortValue(a, sortKey, period) - sortValue(b, sortKey, period);
      if (primary !== 0) return asc ? primary : -primary;
      // 第二順位：淨流；若主排序已是淨流，改以成交額決勝負
      if (sortKey === "flow") {
        const byAmt = periodAmt(a, period) - periodAmt(b, period);
        return asc ? byAmt : -byAmt;
      }
      const secondary = periodFlow(a, period) - periodFlow(b, period);
      return asc ? secondary : -secondary;
    });
    const rows =
      kindFilter === "all"
        ? takeTopMixed(sorted, RANK_LIMIT)
        : sorted.slice(0, RANK_LIMIT);
    return { rows, totalMatched: sorted.length };
  }, [sectors, filter, kindFilter, sortKey, asc, period]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setAsc((v) => !v);
    else {
      setSortKey(key);
      setAsc(false);
    }
  };

  const sortState = (key: SortKey): SortState =>
    sortKey === key ? (asc ? "asc" : "desc") : "none";
  const activeSortLabel =
    columns.find((c) => c.key === sortKey)?.label ?? "成交額";
  const amtLabel =
    period === "day" ? "成交" : period === "d3" ? "3日成交" : "5日成交";
  const flowLabel = period === "day" ? "淨流" : period === "d3" ? "3日流" : "5日流";

  return (
    <div className="flex h-full min-h-[360px] flex-col sm:min-h-[520px]">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            ariaLabel="時間維度"
            size="sm"
            items={PERIOD_ITEMS}
            value={period}
            onChange={setPeriod}
          />
          <Chip tone="outline">
            {kindFilter !== "all" ? KIND_LABEL[kindFilter] : "全部"}
            {filter !== "all" ? ` · ${STATUS_META[filter].label}` : ""}
          </Chip>
        </div>
        <p className="t-kicker">
          TOP {rows.length}
          {totalMatched > rows.length ? ` / ${totalMatched}` : ""} · 依
          {activeSortLabel}
          {asc ? " ↑" : " ↓"}
        </p>
      </div>

      {/* 手機／桌面共用排序狀態，避免只在手機改排序後桌面看起來「數據不一樣」 */}
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

      <div className="scroll-y min-h-0 flex-1 md:hidden">
        <ul className="divide-y divide-line">
          {rows.map((s, i) => {
            const liveStatus = statusFromFlow(s.d5Flow ?? 0, s.accel ?? 0);
            const meta = STATUS_META[liveStatus];
            const kind = (s.kind ?? "theme") as Exclude<KindFilter, "all">;
            const amt = periodAmt(s, period);
            const flow = periodFlow(s, period);
            const sortMetric = sortValue(s, sortKey, period);
            // 成交額是絕對金額，不該帶正號；淨流／加速度才需要帶號
            const sortText =
              sortKey === "heat"
                ? formatHeat(sortMetric)
                : sortKey === "priceChange20d"
                  ? formatPct(sortMetric)
                  : sortKey === "cp"
                    ? sortMetric.toFixed(1)
                    : sortKey === "amt"
                      ? formatMarketYi(sortMetric, market)
                      : formatMarketYiSigned(sortMetric, market);
            const neutralMetric =
              sortKey === "heat" || sortKey === "cp" || sortKey === "amt";
            const selected = selectedId === s.id;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onSelect(s)}
                  aria-pressed={selected}
                  className={cn(
                    "relative flex min-h-[4.5rem] w-full items-center gap-3 py-3 pr-3 pl-4 text-left transition-colors",
                    selected ? "bg-[var(--mk-anchor-bg)]" : "active:bg-sunken",
                  )}
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
                        {s.name}
                      </span>
                      <StatusPill
                        label={meta.label}
                        color={meta.color}
                        background={meta.bg}
                      />
                      <Chip>{KIND_LABEL[kind]}</Chip>
                    </span>
                    <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      {sortKey === "amt" ? null : (
                        <span>
                          {amtLabel}{" "}
                          <Amount
                            text={formatMarketYi(amt, market)}
                            className="text-foreground/75"
                          />
                        </span>
                      )}
                      {sortKey === "flow" ? null : (
                        <span>
                          {flowLabel}{" "}
                          <Amount
                            text={formatMarketYiSigned(flow, market)}
                            className={signedClass(flow)}
                          />
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span
                      className={cn(
                        "num block text-[0.9375rem] font-semibold",
                        neutralMetric
                          ? "text-foreground"
                          : signedClass(sortMetric),
                      )}
                    >
                      {sortKey === "heat" ||
                      sortKey === "cp" ||
                      sortKey === "priceChange20d" ? (
                        sortText
                      ) : (
                        <Amount text={sortText} />
                      )}
                    </span>
                    <span className="t-kicker block">{activeSortLabel}</span>
                  </span>
                  <ChevronRight
                    className="size-4 shrink-0 text-muted-foreground/60"
                    aria-hidden
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="scroll-x hidden min-h-0 flex-1 md:block">
        <table className="data-table min-w-[760px]">
          <thead>
            <tr>
              <th className="w-10 text-right">#</th>
              <th>板塊</th>
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
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => {
              const liveStatus = statusFromFlow(s.d5Flow ?? 0, s.accel ?? 0);
              const meta = STATUS_META[liveStatus];
              const score = cpScore(s);
              const kind = (s.kind ?? "theme") as Exclude<KindFilter, "all">;
              const amt = periodAmt(s, period);
              const flow = periodFlow(s, period);
              return (
                <tr
                  key={s.id}
                  onClick={() => onSelect(s)}
                  data-selected={selectedId === s.id ? "true" : undefined}
                  className="cursor-pointer"
                >
                  <td className="num w-10 text-right text-muted-foreground">
                    {i + 1}
                  </td>
                  <td>
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="truncate font-medium">{s.name}</span>
                      <span className="flex flex-wrap items-center gap-1">
                        <StatusPill
                          label={meta.label}
                          color={meta.color}
                          background={meta.bg}
                          note={s.volumeSpike ? "放量" : undefined}
                        />
                        <Chip>{KIND_LABEL[kind]}</Chip>
                      </span>
                    </div>
                  </td>
                  <td className="cell-num">
                    <Amount text={formatMarketYi(amt, market)} />
                  </td>
                  <td className={cn("cell-num font-semibold", signedClass(flow))}>
                    <Amount text={formatMarketYiSigned(flow, market)} />
                  </td>
                  <td className={cn("cell-num", signedClass(s.accel))}>
                    <Amount text={formatMarketYiSigned(s.accel, market)} />
                  </td>
                  <td className={cn("cell-num", signedClass(s.d20Flow))}>
                    <Amount text={formatMarketYiSigned(s.d20Flow, market, 0)} />
                  </td>
                  <td className="cell-num text-muted-foreground">
                    {formatHeat(s.heat)}
                  </td>
                  <td className={cn("cell-num", signedClass(s.priceChange20d))}>
                    {formatPct(s.priceChange20d)}
                  </td>
                  <td className="cell-num font-semibold text-[var(--mk-surge)]">
                    {Number.isFinite(score) ? score.toFixed(0) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
