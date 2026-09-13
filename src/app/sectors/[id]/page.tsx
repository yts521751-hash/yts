import { SectorKlineView } from "@/components/sector-kline-view";
import {
  buildSectorKline,
  readSectorKlineCache,
} from "@/lib/sector-kline";
import { lookupSectorDef } from "@/lib/resolve-universe";
import { membersWithTurnover } from "@/lib/sector-members";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
};

export const dynamic = "force-dynamic";

function safeDecode(id: string) {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

export default async function SectorPage({ params, searchParams }: Props) {
  const raw = (await params).id;
  const id = safeDecode(raw);
  const from = (await searchParams).from;
  const fromMa = from === "ma";
  const backHref = fromMa ? "/ma" : from === "home" ? "/" : "/ma";
  const backLabel = fromMa || from !== "home" ? "回產業掃描" : "回資金流";

  const def = await lookupSectorDef(id);

  if (!def) {
    return (
      <SectorKlineView
        sectorId={id}
        initialName={id}
        initialError="找不到此產業。請從首頁板塊詳情再進入。"
        backHref={backHref}
        backLabel={backLabel}
      />
    );
  }

  // 首屏只讀快取，避免重建拖慢 TTFB；缺快取時交給客戶端拉 API
  const cached = await readSectorKlineCache(def.id);
  const candles = cached?.candles ?? [];
  const { members, asOf: membersAsOf } = await membersWithTurnover(def.members);

  if (candles.length) {
    // 背景輕觸刷新（不阻塞首屏）
    void buildSectorKline(def.id, 80, { def }).catch(() => null);
  }

  return (
    <SectorKlineView
      sectorId={def.id}
      initialName={def.name}
      initialCandles={candles}
      initialMembers={members}
      initialMembersAsOf={membersAsOf}
      initialError={null}
      backHref={backHref}
      backLabel={backLabel}
    />
  );
}
