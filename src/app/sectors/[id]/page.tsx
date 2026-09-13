import { SectorKlineView } from "@/components/sector-kline-view";
import {
  buildSectorKline,
  readSectorKlineCache,
} from "@/lib/sector-kline";
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

  // 首屏只讀快取，避免重建拖慢 TTFB；缺快取時交給客戶端拉 API
  const cached = await readSectorKlineCache(def.id);
  const candles = cached?.candles ?? [];

  if (candles.length) {
    // 背景輕觸刷新（不阻塞首屏）
    void buildSectorKline(def.id, 80, { def }).catch(() => null);
  }

  return (
    <SectorKlineView
      sectorId={def.id}
      initialName={def.name}
      initialCandles={candles}
      initialMembers={def.members.map((m) => ({
        code: m.code,
        name: m.name,
      }))}
      initialError={null}
    />
  );
}
