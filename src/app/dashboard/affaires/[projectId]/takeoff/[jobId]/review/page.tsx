import { notFound } from "next/navigation";

import { getUserContext } from "@/lib/auth/server";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import TakeoffReviewPage from "@/components/takeoff/TakeoffReviewPage";

type Props = {
  params: Promise<{ projectId: string; jobId: string }>;
  searchParams: Promise<{ versionId?: string }>;
};

export default async function AffaireTakeoffReviewPage({ params, searchParams }: Props) {
  const [{ jobId }, { versionId }] = await Promise.all([params, searchParams]);
  const { tenantId } = await getUserContext();

  if (!tenantId || !versionId) notFound();

  const enabled = await isTakeoffEnabled(tenantId);
  if (!enabled) notFound();

  return <TakeoffReviewPage jobId={jobId} versionId={versionId} />;
}
