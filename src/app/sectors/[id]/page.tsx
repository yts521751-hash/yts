import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SectorKlineChart } from "@/components/sector-kline-chart";
import { buildSectorKline } from "@/lib/sector-kline";
import { lookupSectorDef } from "@/lib/resolve-universe";

type Props = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export default async function SectorPage({ params }: Props) {
  const { id } = await params;
  const def = await lookupSectorDef(id);
  if (!def) notFound();

  const data = await buildSectorKline(id, 80, { def }).catch(() => null);
  const candles = data?.candles ?? [];

  return (
    <div className="relative min-h-full flex-1">
      <div className="pulse-atmosphere pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative z-10 mx-auto max-w-[1100px] px-4 py-8 sm:px-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          回排行榜
        </Link>
        <h1 className="mt-4 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
          {def.name}
        </h1>

        <div className="mt-6 rounded-2xl border border-border/60 bg-[var(--panel)]/80 p-4 backdrop-blur-sm">
          {candles.length ? (
            <SectorKlineChart candles={candles} />
          ) : (
            <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
              尚無日線資料
            </div>
          )}
        </div>

        <div className="mt-4 rounded-2xl border border-border/50 bg-[var(--panel)]/60 p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">成分股</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {[...def.members]
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
      </div>
    </div>
  );
}
