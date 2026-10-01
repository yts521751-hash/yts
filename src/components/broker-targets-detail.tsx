"use client";

import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { BrokerTargetPrice } from "@/lib/broker-targets";
import { cn } from "@/lib/utils";

export type BrokerTargetsDetailProps = {
  code: string;
  name?: string | null;
  /** 若父層已有資料可直接傳入，略過初次 fetch */
  initialTargets?: BrokerTargetPrice[] | null;
  className?: string;
  defaultOpen?: boolean;
  /** 為 true 時掛載即拉（查詢卡）；列表展開再拉 */
  prefetch?: boolean;
};

type ApiPayload = {
  ok?: boolean;
  error?: string;
  targets?: BrokerTargetPrice[];
  emptyReason?: string | null;
  source?: string;
};

function fmtTarget(n: number) {
  if (!Number.isFinite(n)) return "—";
  return n >= 100 ? n.toLocaleString("zh-TW") : n.toFixed(1);
}

/** 價值選股／查詢：「依據」＝逐家券商目標價（非 FactSet 共識） */
export function BrokerTargetsDetail({
  code,
  name,
  initialTargets,
  className,
  defaultOpen = false,
  prefetch = false,
}: BrokerTargetsDetailProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targets, setTargets] = useState<BrokerTargetPrice[]>(
    () => initialTargets ?? [],
  );
  const [emptyReason, setEmptyReason] = useState<string | null>(null);
  const [fetched, setFetched] = useState(() => initialTargets != null);

  const load = useCallback(async () => {
    if (!/^\d{4}$/.test(code)) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ code });
      if (name) qs.set("name", name);
      const res = await fetch(`/api/broker-targets?${qs.toString()}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as ApiPayload;
      if (!res.ok || json.ok === false) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setTargets(json.targets ?? []);
      setEmptyReason(json.emptyReason ?? null);
      setFetched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入失敗");
      setFetched(true);
    } finally {
      setLoading(false);
    }
  }, [code, name]);

  useEffect(() => {
    if (prefetch && !fetched) void load();
  }, [prefetch, fetched, load]);

  useEffect(() => {
    if (open && !fetched && !loading) void load();
  }, [open, fetched, loading, load]);

  const countLabel = fetched
    ? targets.length
      ? ` · ${targets.length} 家`
      : " · 無資料"
    : "";

  return (
    <div className={cn("text-[11px]", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex w-full items-center justify-between gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5 text-left transition hover:bg-muted/60"
        aria-expanded={open}
      >
        <span className="font-medium text-foreground/90">
          券商目標價依據
          {countLabel}
          {loading ? " · 載入中…" : ""}
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          {error ? (
            <p className="text-[11px] text-[var(--mk-ebb)]">{error}</p>
          ) : null}
          {loading && !targets.length ? (
            <p className="text-muted-foreground">正在查詢內外資券商目標價…</p>
          ) : null}
          {!loading && fetched && !targets.length ? (
            <p className="leading-relaxed text-muted-foreground">
              {emptyReason || "尚無逐家券商目標價"}
              。僅在公開新聞標題／內文能辨識「券商＋絕對目標價」時顯示；無具名券商報道時會留空。
            </p>
          ) : null}
          {targets.length ? (
            <ul className="divide-y divide-border/40 overflow-hidden rounded-lg border border-border/40">
              {targets.map((r, i) => (
                <li
                  key={`${r.broker}-${i}`}
                  className="flex items-baseline justify-between gap-3 px-2.5 py-1.5"
                >
                  <span className="min-w-0 truncate text-muted-foreground">
                    {r.url ? (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="truncate underline-offset-2 hover:underline"
                        title={r.snippet ?? r.source ?? undefined}
                      >
                        {r.broker}
                      </a>
                    ) : (
                      <span title={r.snippet ?? r.source ?? undefined}>
                        {r.broker}
                      </span>
                    )}
                    {r.kind === "foreign" ? (
                      <span className="ml-1 text-[10px] opacity-60">外資</span>
                    ) : r.kind === "domestic" ? (
                      <span className="ml-1 text-[10px] opacity-60">國內</span>
                    ) : null}
                    {r.asOf ? (
                      <span className="ml-1 text-[10px] opacity-70">
                        {r.asOf}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {fmtTarget(r.target)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {targets.length ? (
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              目標價取自 Google
              新聞／鉅亨等公開報道中的具名券商研究（非 FactSet
              共識彙總）；同券商保留較新一筆。點券商名可開啟來源。
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export type FundMetricsProps = {
  forwardPe?: number | null;
  nextYearEps?: number | null;
  baseEps?: number | null;
  epsYoy?: number | null;
  className?: string;
};

/** 與價值選股相同口徑的三欄指標（成交值展開亦可复用） */
export function FundMetricsGrid({
  forwardPe,
  nextYearEps,
  baseEps,
  epsYoy,
  className,
}: FundMetricsProps) {
  return (
    <div className={cn("grid grid-cols-3 gap-2 text-[11px]", className)}>
      <div className="rounded-lg bg-muted/40 px-2 py-1.5">
        <div className="text-muted-foreground">前瞻本益比</div>
        <div className="mt-0.5 font-semibold tabular-nums">
          {forwardPe != null && Number.isFinite(forwardPe)
            ? forwardPe.toFixed(1)
            : "—"}
        </div>
      </div>
      <div className="rounded-lg bg-muted/40 px-2 py-1.5">
        <div className="text-muted-foreground">明年／今年 EPS</div>
        <div className="mt-0.5 font-semibold tabular-nums">
          {nextYearEps != null ? nextYearEps.toFixed(2) : "—"}
          {" / "}
          {baseEps != null ? baseEps.toFixed(2) : "—"}
        </div>
      </div>
      <div className="rounded-lg bg-muted/40 px-2 py-1.5">
        <div className="text-muted-foreground">EPS YoY</div>
        <div
          className={cn(
            "mt-0.5 font-semibold tabular-nums",
            epsYoy != null && epsYoy > 0 && "text-[var(--mk-up)]",
          )}
        >
          {epsYoy != null
            ? `${epsYoy > 0 ? "+" : ""}${epsYoy.toFixed(1)}%`
            : "—"}
        </div>
      </div>
    </div>
  );
}
