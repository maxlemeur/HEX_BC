import { notFound } from "next/navigation";

import { getUserContext } from "@/lib/auth/server";
import { resolveTakeoffReviewScope } from "@/lib/takeoff/version-access-server";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import TakeoffReviewPage from "@/components/takeoff/TakeoffReviewPage";
import { TakeoffPlanLocationsPanel } from "@/components/takeoff/TakeoffPlanLocationsPanel";
import { TakeoffRequestPlansNav } from "@/components/takeoff/TakeoffRequestPlansNav";

type Props = {
  params: Promise<{ projectId: string; jobId: string }>;
  searchParams: Promise<{ versionId?: string }>;
};

export default async function AffaireTakeoffReviewPage({ params, searchParams }: Props) {
  const [{ projectId, jobId }, { versionId }] = await Promise.all([params, searchParams]);
  const { tenantId, profile } = await getUserContext();

  if (!tenantId) notFound();

  const enabled = await isTakeoffEnabled(tenantId);
  if (!enabled) notFound();

  const scope = await resolveTakeoffReviewScope({ projectId, jobId, versionId });
  if (!scope) notFound();

  return (
    <div className="min-w-0">
      {/* The other plans of the same launch request: which are missing, and the way to the next one read. */}
      <TakeoffRequestPlansNav projectId={projectId} jobId={jobId} viewerKey={`${tenantId}:${profile?.id ?? ""}`} />
      <TakeoffReviewPage
        jobId={jobId}
        versionId={scope.versionId} canEdit={scope.canEdit}
        projectId={projectId}
      />
      <TakeoffPlanLocationsPanel jobId={jobId} />
    </div>
  );
}
