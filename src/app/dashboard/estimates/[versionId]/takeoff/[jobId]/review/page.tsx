import { notFound } from "next/navigation";

import { TakeoffDeprecationBanner } from "@/components/takeoff/TakeoffDeprecationBanner";
import { getUserContext } from "@/lib/auth/server";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import TakeoffReviewPage from "@/components/takeoff/TakeoffReviewPage";
import {
  buildTakeoffRouteHierarchy,
  fetchTakeoffVersionProjectContext,
} from "@/lib/takeoff/route-hierarchy";

export default async function TakeoffReviewServerPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ versionId: string; jobId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const [{ versionId, jobId }, reviewSearchParams] = await Promise.all([
    params,
    searchParams,
  ]);
  const { tenantId } = await getUserContext();

  if (!tenantId || versionId.trim().length === 0 || jobId.trim().length === 0) {
    notFound();
  }

  const enabled = await isTakeoffEnabled(tenantId);
  if (!enabled) {
    notFound();
  }

  const routeDescriptor = buildTakeoffRouteHierarchy({
    kind: "estimate_review_legacy",
    versionId,
    jobId,
    searchParams: {
      ...reviewSearchParams,
      versionId,
    },
    ...(await fetchTakeoffVersionProjectContext(versionId)),
  });

  return (
    <div className="space-y-4">
      <TakeoffDeprecationBanner descriptor={routeDescriptor} />
      <TakeoffReviewPage jobId={jobId} versionId={versionId} />
    </div>
  );
}
