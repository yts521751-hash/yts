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
  StatusPill,
} from "@/components/ui/chip";
import { Panel } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { ErrorState, LoadingState, NoticeBar } from "@/components/ui/states";

type RankPeriod = "day" | "d3" | "d5";
type ScopeFilter = "industry" | "theme" | "all";
type MegaFilter = "all" | IndustryMegaGroup;

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

  const flowLadders = useMemo(() => {
    const list = (data?.rows ?? []).filter((r) => {
      const kind = r.kind ?? "theme";
      if (scope === "industry" && kind !== "industry") return false;
      if (scope === "theme" && kind === "industry") return false;
      if (scope === "industry" && mega !== "all" && r.megaGroup !== mega) {
        return false;
      }
      return true;
    });
    const inflow = list
      .filter((r) => periodFlow(r, period) > 0)
      .sort((a, b) => periodFlow(b, period) - periodFlow(a, period));
    const outflow = list
      .filter((r) => periodFlow(r, period) < 0)
      .sort((a, b) => periodFlow(a, period) - periodFlow(b, period));
    const maxAbs = Math.max(
      1,
      ...list.map((r) => Math.abs(periodFlow(r, period))),
    );
    return {
      inflow,
      outflow,
      maxAbs,
      inflowTotal: inflow.reduce((sum, r) => sum + periodFlow(r, period), 0),
      outflowTotal: outflow.reduce((sum, r) => sum + periodFlow(r, period), 0),
    };
  }, [data?.rows, scope, mega, period]);

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
              <ColumnTip tip={data?.metricNote ?? COLUMN_TIPS.flow}>
                <Chip tone="outline">EOD 混合金流 · 80/20</Chip>
              </ColumnTip>
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
                  流入 {flowLadders.inflow.length} · 流出{" "}
                  {flowLadders.outflow.length} · 全成分 ISIN 加總
                </p>
              </div>
            ) : (
              <p className="t-kicker">
                流入 {flowLadders.inflow.length} · 流出{" "}
                {flowLadders.outflow.length}
                {scope === "theme"
                  ? " · 題材為人工供應鏈名單（接近 CMoney 題材，非官方產業）"
                  : ""}
              </p>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {(direction === "all" || direction === "in") && (
              <FlowLadder
                title="資金流入"
                tone="in"
                rows={flowLadders.inflow}
                period={period}
                maxAbs={flowLadders.maxAbs}
                total={flowLadders.inflowTotal}
              />
            )}
            {(direction === "all" || direction === "out") && (
              <FlowLadder
                title="資金流出"
                tone="out"
                rows={flowLadders.outflow}
                period={period}
                maxAbs={flowLadders.maxAbs}
                total={flowLadders.outflowTotal}
              />
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}

function FlowLadder({
  title,
  tone,
  rows,
  period,
  maxAbs,
  total,
}: {
  title: string;
  tone: "in" | "out";
  rows: IndustryFlowRow[];
  period: RankPeriod;
  maxAbs: number;
  total: number;
}) {
  const isIn = tone === "in";
  const color = isIn ? "var(--mk-up)" : "var(--mk-down)";
  const background = isIn ? "var(--mk-up-bg)" : "var(--mk-down-bg)";
  const periodLabel =
    period === "day" ? "當日淨流" : period === "d3" ? "3 日淨流" : "5 日淨流";

  return (
    <Panel className="overflow-hidden">
      <div
        className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line px-4 py-3"
        style={{ background }}
      >
        <div>
          <p className="t-eyebrow" style={{ color }}>
            {isIn ? "INFLOW LADDER" : "OUTFLOW LADDER"}
          </p>
          <h2 className="t-title mt-0.5">{title}</h2>
        </div>
        <div className="text-right">
          <Amount
            text={formatMarketYiSigned(total)}
            className={cn("text-lg font-semibold", signedClass(total))}
          />
          <p className="t-kicker mt-0.5">{rows.length} 個族群</p>
        </div>
      </div>

      {rows.length ? (
        <ol className="divide-y divide-line">
          {rows.map((r, index) => {
            const flow = periodFlow(r, period);
            const insti = periodInsti(r, period);
            const amt = periodAmt(r, period);
            const meta = STATUS_META[statusFromFlow(r.d5Flow ?? 0, r.accel ?? 0)];
            const width = Math.max(4, (Math.abs(flow) / maxAbs) * 100);
            return (
              <li key={r.id}>
                <Link
                  href={`/sectors/${encodeURIComponent(r.id)}?from=industry-flow`}
                  className="group relative block min-h-[5.25rem] overflow-hidden px-3 py-3 transition-colors hover:bg-sunken active:bg-sunken sm:px-4"
                >
                  <span
                    className={cn(
                      "absolute top-0 bottom-0 opacity-20 transition-[width] duration-300",
                      isIn ? "left-0" : "right-0",
                    )}
                    style={{ width: `${width}%`, background: color }}
                    aria-hidden
                  />
                  <span
                    className={cn(
                      "absolute top-2 bottom-2 w-px bg-line-strong/80",
                      isIn ? "left-0" : "right-0",
                    )}
                    aria-hidden
                  />
                  <span className="relative flex items-start gap-3">
                    <RankSlot rank={index + 1} emphasis />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate font-medium">{r.name}</span>
                        <StatusPill
                          label={meta.label}
                          color={meta.color}
                          background={meta.bg}
                        />
                        <Chip>
                          {r.kind === "industry" && r.megaGroup
                            ? r.megaGroup
                            : "題材"}
                        </Chip>
                        {r.fullRollup ? <Chip tone="outline">全成分</Chip> : null}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
                        <span>
                          法人{" "}
                          <Amount
                            text={formatMarketYiSigned(insti)}
                            className={signedClass(insti)}
                          />
                        </span>
                        <span>
                          成交 <Amount text={formatMarketYi(amt)} />
                        </span>
                        <span className={signedClass(r.priceChange20d)}>
                          20 日 {formatPct(r.priceChange20d)}
                        </span>
                        <span className={signedClass(r.accel)}>
                          加速 {formatMarketYiSigned(r.accel)}
                        </span>
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <Amount
                        text={formatMarketYiSigned(flow)}
                        className={cn("text-base font-semibold", signedClass(flow))}
                      />
                      <span className="t-kicker mt-0.5 block">{periodLabel}</span>
                    </span>
                    <ChevronRight
                      className="mt-1 size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="t-meta px-4 py-10 text-center">
          此範圍暫無{title}資料。
        </p>
      )}
    </Panel>
  );
}
