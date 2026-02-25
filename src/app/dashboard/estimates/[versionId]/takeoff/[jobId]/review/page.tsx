import { notFound } from "next/navigation";

import { getUserContext } from "@/lib/auth/server";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import TakeoffReviewTable from "@/components/takeoff/TakeoffReviewTable";

export default async function TakeoffReviewPage({
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

  return <TakeoffReviewTable jobId={jobId} versionId={versionId} />;
}
