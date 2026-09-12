import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SectorKlinePanel } from "@/components/sector-kline-chart";
import { SECTOR_UNIVERSE } from "@/lib/sector-universe";

type Props = { params: Promise<{ id: string }> };

export default async function SectorPage({ params }: Props) {
  const { id } = await params;
  const def = SECTOR_UNIVERSE.find((s) => s.id === id);
  if (!def) notFound();

  return (
    <div className="relative min-h-full flex-1">
      <div className="tide-atmosphere pointer-events-none absolute inset-0" aria-hidden />
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
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          產業合成 K 線：以成分股當日成交金額為權重，融合個股開高低收報酬（類似三竹族群圖）。
          下方對照每日流入／流出——成交金額 × softSign(漲跌幅)。
        </p>
        <div className="mt-6 rounded-2xl border border-border/60 bg-[var(--panel)]/80 p-4 backdrop-blur-sm">
          <SectorKlinePanel sectorId={def.id} />
        </div>
        <div className="mt-4 rounded-2xl border border-border/50 bg-[var(--panel)]/60 p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">成分股</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {def.members.map((m) => (
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
