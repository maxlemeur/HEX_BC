import { notFound } from "next/navigation";

import { TakeoffDeprecationBanner } from "@/components/takeoff/TakeoffDeprecationBanner";
import { getUserContext } from "@/lib/auth/server";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import TakeoffJobMonitor from "@/components/takeoff/TakeoffJobMonitor";
import {
  buildTakeoffRouteHierarchy,
  fetchTakeoffVersionProjectContext,
} from "@/lib/takeoff/route-hierarchy";

export default async function TakeoffJobPage({
  params,
}: Readonly<{
  params: Promise<{ versionId: string; jobId: string }>;
}>) {
  const { versionId, jobId } = await params;
  const { tenantId } = await getUserContext();

  if (!tenantId || versionId.trim().length === 0 || jobId.trim().length === 0) {
    notFound();
  }

  const enabled = await isTakeoffEnabled(tenantId);
  if (!enabled) {
    notFound();
  }

  const routeDescriptor = buildTakeoffRouteHierarchy({
    kind: "estimate_job_legacy",
    versionId,
    jobId,
    ...(await fetchTakeoffVersionProjectContext(versionId)),
  });

  return (
    <div className="space-y-4">
      <TakeoffDeprecationBanner descriptor={routeDescriptor} />
      <TakeoffJobMonitor jobId={jobId} versionId={versionId} />
    </div>
  );
}
