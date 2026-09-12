"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

type NewsItem = {
  id: string;
  title: string;
  link: string;
  source: string;
  publishedAt: string | null;
  summary: string;
};

function formatTime(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-TW", { hour12: false });
  } catch {
    return iso;
  }
}

export default function NewsPage() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [builtAt, setBuiltAt] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (force = false) => {
    setError(null);
    try {
      const res = await fetch(`/api/news${force ? "?force=1" : ""}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!data.ok && !data.items?.length) {
        throw new Error(data.error || "新聞載入失敗");
      }
      setItems(data.items ?? []);
      setBuiltAt(data.builtAt ?? "");
      setSyncing(Boolean(data.syncing));
      setSource(String(data.source ?? ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    if (!syncing) return;
    const t = setInterval(() => void load(false), 8000);
    return () => clearInterval(t);
  }, [syncing, load]);

  // 頁面開啟時每 10 分鐘自動跟一次 active（伺服器端排程也會灰度更新）
  useEffect(() => {
    const t = setInterval(() => void load(false), 1000 * 60 * 10);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="relative min-h-full flex-1">
      <div className="tide-atmosphere pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative z-10 mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            回資金流排行
          </Link>
          <button
            type="button"
            onClick={() => void load(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border/50 bg-muted/30 px-3 py-2 text-xs font-medium transition hover:bg-muted/60"
          >
            <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
            觸發灰度更新
          </button>
        </div>

        <h1 className="mt-4 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
          重點熱議新聞
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          彙整台股／半導體／AI 伺服器相關頭條。伺服器每 10 分鐘灰度抓取（staging→active），
          本頁讀 active，不會卡住等 RSS。
          {builtAt ? ` 更新於 ${formatTime(builtAt)}` : ""}
          {source ? ` · ${source}` : ""}
          {syncing ? " · 背景同步中" : ""}
        </p>

        <div className="mt-6 space-y-3">
          {loading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">載入中…</p>
          ) : error ? (
            <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-6 text-sm">
              {error}
            </p>
          ) : (
            items.map((n) => (
              <a
                key={n.id}
                href={n.link}
                target="_blank"
                rel="noreferrer"
                className="block rounded-2xl border border-border/60 bg-[var(--panel)]/80 p-4 backdrop-blur-sm transition hover:border-border hover:bg-[var(--panel)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-[family-name:var(--font-display)] text-base font-semibold leading-snug">
                      {n.title}
                    </p>
                    {n.summary ? (
                      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                        {n.summary}
                      </p>
                    ) : null}
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {n.source} · {formatTime(n.publishedAt)}
                    </p>
                  </div>
                  <ExternalLink className="mt-1 size-4 shrink-0 text-muted-foreground" />
                </div>
              </a>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
