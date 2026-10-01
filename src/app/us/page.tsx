import { HomeApp } from "@/components/home-app";
import { getActiveUsFlowPayload } from "@/lib/build-flow-us";
import { migrateSectorIfNeeded } from "@/lib/mock-data";

export const dynamic = "force-dynamic";

export default async function UsHome() {
  const payload = await getActiveUsFlowPayload();
  const initialFlow =
    payload?.sectors?.length
      ? {
          sectors: payload.sectors.map(migrateSectorIfNeeded),
          brief: payload.brief,
          source: String(payload.source ?? "cache"),
          isDemo: false,
        }
      : null;

  return <HomeApp initialFlow={initialFlow} market="us" />;
}
