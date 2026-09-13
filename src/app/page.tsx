import { HomeApp } from "@/components/home-app";
import { getActiveFlowPayload } from "@/lib/build-flow";
import { migrateSectorIfNeeded } from "@/lib/mock-data";

export const dynamic = "force-dynamic";

export default async function Home() {
  const payload = await getActiveFlowPayload();
  const initialFlow =
    payload?.sectors?.length
      ? {
          sectors: payload.sectors.map(migrateSectorIfNeeded),
          brief: payload.brief,
          source: String(payload.source ?? "cache"),
          isDemo: false,
        }
      : null;

  return <HomeApp initialFlow={initialFlow} />;
}
