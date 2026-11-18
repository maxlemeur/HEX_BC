import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { getUserContext } from "@/lib/auth/server";
import { mapSupabaseError } from "@/lib/estimates/errors";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { getTakeoffLinkedSourceVersionByJobId } from "@/lib/takeoff/version-links";

type Props = {
  params: Promise<{ unknown: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Resolve saved estimate-scoped bookmarks with the caller's session. */
export default async function UnknownDashboardRoute({ params, searchParams }: Props) {
  const { unknown: segments } = await params;
  const [area, versionId, section, jobId, view] = segments;
  if (area === "takeoff" && segments.length === 1) redirect("/dashboard/affaires");
  if (area !== "estimates" || !z.uuid().safeParse(versionId).success) notFound();
  if (section === "plans") {
    if (segments.length !== 3) notFound();
  } else if (section === "takeoff") {
    if (segments.length > 5 || (view && view !== "review") ||
      (jobId === "new" && view) || (jobId && jobId !== "new" && !z.uuid().safeParse(jobId).success)) notFound();
  } else {
    notFound();
  }

  const { tenantId } = await getUserContext();
  if (!tenantId || !(await isTakeoffEnabled(tenantId))) notFound();
  const context = await getAuthenticatedContext();
  let query = context.supabase.from("estimate_versions")
    .select("project_id, estimate_projects!inner(user_id)")
    .eq("tenant_id", context.tenantId).eq("id", versionId)
    .eq("estimate_projects.tenant_id", context.tenantId)
    .eq("estimate_projects.is_archived", false);
  if (context.tenantRole !== "admin" && context.tenantRole !== "director") {
    query = query.eq("estimate_projects.user_id", context.userId);
  }
  const { data: version, error } = await query.maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible de retrouver l’affaire.");
  if (!version) notFound();
  const affaire = `/dashboard/affaires/${version.project_id}`;
  if (section === "plans") redirect(`${affaire}/plans`);
  const takeoff = `${affaire}/takeoff`;
  if (!jobId) redirect(`${takeoff}?version=${versionId}`);
  const search = await searchParams;
  if (jobId === "new") {
    const launch = new URLSearchParams({ launch: "1", version: versionId });
    if (typeof search.plan_set_id === "string") launch.set("launchPlanSet", search.plan_set_id);
    redirect(`${takeoff}?${launch}`);
  }
  const { data: job, error: jobError } = await context.supabase.from("takeoff_jobs")
    .select("estimate_version_id, status").eq("tenant_id", context.tenantId).eq("id", jobId).maybeSingle();
  if (jobError) throw mapSupabaseError(jobError, "Impossible de retrouver le métré.");
  if (!job) notFound();
  if (job.estimate_version_id !== versionId) {
    const links = await getTakeoffLinkedSourceVersionByJobId({
      supabase: context.supabase, tenantId: context.tenantId, targetVersionId: versionId, jobIds: [jobId],
    });
    if (links.get(jobId)?.source_version_id !== job.estimate_version_id) notFound();
  }
  if (!view && job.status !== "completed" && job.status !== "applied") {
    redirect(`${takeoff}?version=${versionId}`);
  }
  const review = new URLSearchParams({ versionId });
  for (const [key, value] of Object.entries(search)) {
    if (key !== "versionId" && value !== undefined) {
      for (const entry of Array.isArray(value) ? value : [value]) review.append(key, entry);
    }
  }
  redirect(`${takeoff}/${jobId}/review?${review}`);
}
