import { notFound } from "next/navigation";

import { getUserContext } from "@/lib/auth/server";
import { resolveTakeoffReviewScope } from "@/lib/takeoff/version-access-server";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import TakeoffReviewPage from "@/components/takeoff/TakeoffReviewPage";

type Props = {
  params: Promise<{ projectId: string; jobId: string }>;
  searchParams: Promise<{ versionId?: string }>;
};

export default async function AffaireTakeoffReviewPage({ params, searchParams }: Props) {
  const [{ projectId, jobId }, { versionId }] = await Promise.all([params, searchParams]);
  const { tenantId } = await getUserContext();

  if (!tenantId) notFound();

  const enabled = await isTakeoffEnabled(tenantId);
  if (!enabled) notFound();

  const scope = await resolveTakeoffReviewScope({ projectId, jobId, versionId });
  if (!scope) notFound();

  return (
    <div className="min-w-0">
      <TakeoffReviewPage
        jobId={jobId}
        versionId={scope.versionId} canEdit={scope.canEdit}
        projectId={projectId}
      />
    </div>
  );
}
