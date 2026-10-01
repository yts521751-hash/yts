import { SectorKlineView } from "@/components/sector-kline-view";
import {
  buildUsSectorKline,
  readUsSectorKlineCache,
} from "@/lib/sector-kline-us";
import { lookupUsSectorDef } from "@/lib/us-sector-universe";

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

export default async function UsSectorPage({ params, searchParams }: Props) {
  const raw = (await params).id;
  const id = safeDecode(raw);
  const from = (await searchParams).from;
  const fromMa = from === "ma";
  const backHref = fromMa ? "/us/ma" : from === "home" ? "/us" : "/us/ma";
  const backLabel = fromMa || from !== "home" ? "回產業掃描" : "回美股資金流";

  const def = lookupUsSectorDef(id);
  if (!def) {
    return (
      <SectorKlineView
        sectorId={id}
        initialName={id}
        initialError="找不到此美股產業。請從首頁板塊詳情再進入。"
        backHref={backHref}
        backLabel={backLabel}
      />
    );
  }

  let payload = await readUsSectorKlineCache(id);
  if (!payload?.candles?.length) {
    payload = (await buildUsSectorKline(id).catch(() => null)) ?? null;
  }

  return (
    <SectorKlineView
      sectorId={id}
      initialName={def.name}
      initialCandles={payload?.candles ?? []}
      initialError={
        payload?.candles?.length
          ? null
          : "尚無 K 線快取。請回美股首頁按「同步資料」。"
      }
      backHref={backHref}
      backLabel={backLabel}
    />
  );
}
