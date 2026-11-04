import { notFound } from "next/navigation";

import { TakeoffTargetedReview } from "@/components/takeoff/review/TakeoffTargetedReview";
import { getUserContext } from "@/lib/auth/server";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";

export const metadata = { title: "Revue ciblée du métré" };

type Props = {
  params: Promise<{ projectId: string; jobId: string }>;
  searchParams: Promise<{ versionId?: string }>;
};

/**
 * Targeted review of a takeoff job (TI-664 L5c): only the lines the apply guard rejects or finds uncertain, in the
 * « tool » layout of the dashboard (no margins, no footer, only its panels scroll). Same access as the job's review.
 */
export default async function AffaireTakeoffTargetedReviewPage({ params, searchParams }: Props) {
  const [{ projectId, jobId }, { versionId }] = await Promise.all([params, searchParams]);
  const { tenantId } = await getUserContext();

  if (!tenantId || !versionId) notFound();
  if (!(await isTakeoffEnabled(tenantId))) notFound();

  return <TakeoffTargetedReview jobId={jobId} versionId={versionId} projectId={projectId} />;
}
