import { notFound, redirect } from "next/navigation";

import { getUserContext } from "@/lib/auth/server";
import { getAuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import { readTakeoffReviewLink, resolveTakeoffReviewLink } from "@/lib/takeoff/review-link";
import { readTakeoffReviewLinkFacts } from "@/lib/takeoff/review-link-server";
import { resolveTakeoffReviewScope } from "@/lib/takeoff/version-access-server";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import TakeoffReviewPage from "@/components/takeoff/TakeoffReviewPage";
import { TakeoffPlanLocationsPanel } from "@/components/takeoff/TakeoffPlanLocationsPanel";
import { TakeoffRequestPlansNav } from "@/components/takeoff/TakeoffRequestPlansNav";

type Props = {
  params: Promise<{ projectId: string; jobId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AffaireTakeoffReviewPage({ params, searchParams }: Props) {
  const [{ projectId, jobId }, query] = await Promise.all([params, searchParams]);
  // A version given twice names none: not found, as the access check below answers it.
  if (Array.isArray(query.versionId)) notFound();
  const versionId = query.versionId;
  const { tenantId, profile } = await getUserContext();

  if (!tenantId) notFound();

  const enabled = await isTakeoffEnabled(tenantId);
  if (!enabled) notFound();

  const scope = await resolveTakeoffReviewScope({ projectId, jobId, versionId });
  if (!scope) notFound();

  // Access to the job and to its version or carry-over is proven above. A job read against the affaire's list is
  // reviewed in the table of items (review-link.ts): its link lands there, with no side effect; any other job's review
  // opens here as today.
  const context = await getAuthenticatedTakeoffContext();
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) search.append(name, entry);
  }
  const link = readTakeoffReviewLink({ projectId: projectId.toLowerCase(), jobId: jobId.toLowerCase() }, search);
  const facts = await readTakeoffReviewLinkFacts({ supabase: context.supabase, tenantId: context.tenantId,
    projectId: link.projectId, jobId: link.jobId, versionId: scope.versionId, line: link.line ?? null });
  const destination = resolveTakeoffReviewLink(link, facts);
  if (destination.kind !== "historical") redirect(destination.href);

  return (
    <div className="min-w-0">
      {/* The other plans of the same launch request: which are missing, and the way to the next one read. */}
      <TakeoffRequestPlansNav projectId={projectId} jobId={jobId} viewerKey={`${tenantId}:${profile?.id ?? ""}`} />
      <TakeoffReviewPage
        jobId={jobId}
        versionId={scope.versionId} canEdit={scope.canEdit}
        projectId={projectId}
        readsItemList={facts.readsList}
      />
      <TakeoffPlanLocationsPanel jobId={jobId} />
    </div>
  );
}
