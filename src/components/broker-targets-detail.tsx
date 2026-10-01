"use client";

import { ChevronDown } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { BrokerTargetPrice } from "@/lib/broker-targets";
import { shouldApplyBrokerFetch } from "@/lib/broker-fetch-guard";
import { tryReadResponseJson } from "@/lib/read-response-json";
import { cn } from "@/lib/utils";

const FRIENDLY_EMPTY = "尚無逐家券商目標價";

function isJsonParseNoise(message: string) {
  return /json|unexpected end|unexpected token|failed to execute|parse/i.test(
    message,
  );
}

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

type ClientHit = {
  targets: BrokerTargetPrice[];
  emptyReason: string | null;
  at: number;
};

const CLIENT_TTL_MS = 30 * 60 * 1000;
const clientBrokerCache = new Map<string, ClientHit>();

function fmtTarget(n: number) {
  if (!Number.isFinite(n)) return "—";
  return n >= 100 ? n.toLocaleString("zh-TW") : n.toFixed(1);
}

function seedForCode(
  code: string,
  initialTargets?: BrokerTargetPrice[] | null,
): {
  targets: BrokerTargetPrice[];
  emptyReason: string | null;
  fetched: boolean;
} {
  const hit = clientBrokerCache.get(code);
  if (hit && Date.now() - hit.at < CLIENT_TTL_MS) {
    return {
      targets: hit.targets,
      emptyReason: hit.emptyReason,
      fetched: true,
    };
  }
  if (initialTargets != null) {
    return { targets: initialTargets, emptyReason: null, fetched: true };
  }
  return { targets: [], emptyReason: null, fetched: false };
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
  const seeded = seedForCode(code, initialTargets);
  const [open, setOpen] = useState(defaultOpen);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targets, setTargets] = useState<BrokerTargetPrice[]>(
    () => seeded.targets,
  );
  const [emptyReason, setEmptyReason] = useState<string | null>(
    () => seeded.emptyReason,
  );
  const [fetched, setFetched] = useState(() => seeded.fetched);
  const abortRef = useRef<AbortController | null>(null);
  const codeRef = useRef(code);

  // 換股時在 paint 前清掉舊股清單，避免 B 標題下閃 A 的券商列
  useLayoutEffect(() => {
    if (codeRef.current === code) return;
    codeRef.current = code;
    abortRef.current?.abort();
    abortRef.current = null;
    const next = seedForCode(code, initialTargets);
    setTargets(next.targets);
    setEmptyReason(next.emptyReason);
    setFetched(next.fetched);
    setLoading(false);
    setError(null);
  }, [code, initialTargets]);

  const load = useCallback(async () => {
    const requestCode = code;
    if (!/^\d{4}$/.test(requestCode)) return;
    if (codeRef.current !== requestCode) return;

    const cached = clientBrokerCache.get(requestCode);
    if (cached && Date.now() - cached.at < CLIENT_TTL_MS) {
      if (!shouldApplyBrokerFetch(requestCode, codeRef.current, false)) return;
      setTargets(cached.targets);
      setEmptyReason(cached.emptyReason);
      setFetched(true);
      setLoading(false);
      setError(null);
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    // 換股載入時先清空舊列，避免 loading 期間仍顯示上一檔
    setTargets([]);
    setEmptyReason(null);
    try {
      const qs = new URLSearchParams({ code: requestCode });
      if (name) qs.set("name", name);
      const res = await fetch(`/api/broker-targets?${qs.toString()}`, {
        cache: "no-store",
        signal: ac.signal,
      });
      // 安全解析：空 body／非 JSON 不拋原生 Unexpected end of JSON input
      const json = await tryReadResponseJson<ApiPayload>(res);
      if (
        !shouldApplyBrokerFetch(
          requestCode,
          codeRef.current,
          ac.signal.aborted,
        )
      ) {
        return;
      }

      if (!json) {
        if (!res.ok) {
          setError(
            res.status >= 500
              ? `伺服器忙碌或暫時無法取得券商目標價（HTTP ${res.status}），請稍後再試`
              : `無法取得券商目標價（HTTP ${res.status}）`,
          );
          setTargets([]);
          setEmptyReason(null);
        } else {
          // 200 但空／非法 body：當無券商依據的友善空狀態，不顯示解析錯誤
          setError(null);
          setTargets([]);
          setEmptyReason(FRIENDLY_EMPTY);
          clientBrokerCache.set(requestCode, {
            targets: [],
            emptyReason: FRIENDLY_EMPTY,
            at: Date.now(),
          });
        }
        setFetched(true);
        return;
      }

      if (!res.ok || json.ok === false) {
        throw new Error(
          json.error || `無法取得券商目標價（HTTP ${res.status}）`,
        );
      }
      const nextTargets = Array.isArray(json.targets) ? json.targets : [];
      const nextEmpty =
        json.emptyReason ?? (nextTargets.length ? null : FRIENDLY_EMPTY);
      setTargets(nextTargets);
      setEmptyReason(nextEmpty);
      setError(null);
      setFetched(true);
      clientBrokerCache.set(requestCode, {
        targets: nextTargets,
        emptyReason: nextEmpty,
        at: Date.now(),
      });
    } catch (e) {
      if (
        !shouldApplyBrokerFetch(
          requestCode,
          codeRef.current,
          ac.signal.aborted,
        )
      ) {
        return;
      }
      const msg = e instanceof Error ? e.message : "載入失敗";
      // 絕不把原生 JSON parse 字串丟上 UI
      if (isJsonParseNoise(msg)) {
        setError(null);
        setTargets([]);
        setEmptyReason(FRIENDLY_EMPTY);
      } else {
        setError(msg);
      }
      setFetched(true);
    } finally {
      if (
        shouldApplyBrokerFetch(requestCode, codeRef.current, ac.signal.aborted)
      ) {
        setLoading(false);
      }
    }
  }, [code, name]);

  useEffect(() => {
    if (prefetch && !fetched) void load();
  }, [prefetch, fetched, load]);

  useEffect(() => {
    if (open && !fetched && !loading) void load();
  }, [open, fetched, loading, load]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

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
              {emptyReason || FRIENDLY_EMPTY}
              。僅在公開新聞標題／內文能辨識「券商＋絕對目標價」時顯示；無具名券商報道時會留空。
            </p>
          ) : null}
          {targets.length ? (
            <ul className="divide-y divide-border/40 overflow-hidden rounded-lg border border-border/40">
              {targets.map((r, i) => {
                const epsLabel = r.epsYear
                  ? `預估${r.epsYear} EPS`
                  : "預估 EPS";
                const epsValue =
                  r.eps != null && Number.isFinite(r.eps)
                    ? r.eps.toFixed(2)
                    : "—";
                return (
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
                    <span className="shrink-0 text-right tabular-nums leading-snug">
                      <span className="font-semibold">
                        目標價{" "}
                        {r.target != null ? fmtTarget(r.target) : "—"}
                      </span>
                      <span className="ml-1 font-normal text-muted-foreground">
                        ，{epsLabel} {epsValue}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {targets.length ? (
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              目標價／EPS 取自 Google 新聞、Bing、鉅亨、Yahoo ADR
              等公開報道中的具名券商研究（非 FactSet
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
