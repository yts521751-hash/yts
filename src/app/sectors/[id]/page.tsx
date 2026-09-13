import { SectorKlineView } from "@/components/sector-kline-view";
import { buildSectorKline } from "@/lib/sector-kline";
import { lookupSectorDef } from "@/lib/resolve-universe";

type Props = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

function safeDecode(id: string) {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

export default async function SectorPage({ params }: Props) {
  const raw = (await params).id;
  const id = safeDecode(raw);
  const def = await lookupSectorDef(id);

  if (!def) {
    return (
      <SectorKlineView
        sectorId={id}
        initialName={id}
        initialError="找不到此產業。請從首頁板塊詳情再進入。"
      />
    );
  }

  const data = await buildSectorKline(id, 80, { def }).catch(() => null);
  const candles = data?.candles ?? [];

  return (
    <SectorKlineView
      sectorId={def.id}
      initialName={def.name}
      initialCandles={candles}
      initialMembers={def.members.map((m) => ({ code: m.code, name: m.name }))}
      initialError={
        candles.length
          ? null
          : "產業 K 線資料不足（本機日行情快取不夠）。可點再試一次，或回首頁觸發背景更新後重開。"
      }
    />
  );
}
