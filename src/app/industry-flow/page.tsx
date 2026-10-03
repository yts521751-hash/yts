import { IndustryFlowClient } from "@/components/industry-flow-client";
import { getIndustryFlowPayload } from "@/lib/build-industry-flow";

export const dynamic = "force-dynamic";

export default async function IndustryFlowPage() {
  const initial = await getIndustryFlowPayload().catch(() => null);
  return <IndustryFlowClient initial={initial} />;
}
