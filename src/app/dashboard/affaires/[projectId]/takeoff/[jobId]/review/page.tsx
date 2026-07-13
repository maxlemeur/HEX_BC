import { notFound } from "next/navigation";

import { TakeoffRouteHierarchyBanner } from "@/components/takeoff/TakeoffRouteHierarchyBanner";
import { getUserContext } from "@/lib/auth/server";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { buildTakeoffRouteHierarchy } from "@/lib/takeoff/route-hierarchy";
import TakeoffReviewPage from "@/components/takeoff/TakeoffReviewPage";

type Props = {
  params: Promise<{ projectId: string; jobId: string }>;
  searchParams: Promise<{ versionId?: string }>;
};

export default async function AffaireTakeoffReviewPage({ params, searchParams }: Props) {
  const [{ projectId, jobId }, { versionId }] = await Promise.all([params, searchParams]);
  const { tenantId } = await getUserContext();

  if (!tenantId || !versionId) notFound();

  const enabled = await isTakeoffEnabled(tenantId);
  if (!enabled) notFound();

  return (
    <div className="min-w-0 space-y-4">
      <TakeoffRouteHierarchyBanner
        descriptor={buildTakeoffRouteHierarchy({ kind: "affaire_review" })}
      />
      <TakeoffReviewPage
        jobId={jobId}
        versionId={versionId}
        projectId={projectId}
      />
    </div>
  );
}
