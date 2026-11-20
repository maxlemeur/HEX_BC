import "server-only";

import type { resolveLocalTakeoffProvider } from "@/lib/ai/chatgpt-takeoff";
import type { ServerSupabaseClient } from "@/lib/auth/tenant-context";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import type { TakeoffJobProcessingRow } from "@/lib/takeoff/job-lifecycle";

/** A service-role read does not authorize spending the creator's local plan. */
async function assertAffaireTakeoffExecutionAccess(supabase: ServerSupabaseClient, job: TakeoffJobProcessingRow) {
  const { id, tenant_id: tenantId, project_id: projectId, created_by: userId } = job;
  if (projectId && userId) {
    const [project, membership] = await Promise.all([
      supabase.from("estimate_projects").select("user_id")
        .eq("id", projectId).eq("tenant_id", tenantId).eq("is_archived", false).maybeSingle(),
      supabase.from("tenant_memberships").select("role, tenants!inner(is_active)")
        .eq("user_id", userId).eq("tenant_id", tenantId).eq("tenants.is_active", true).maybeSingle(),
    ]);
    if (!project.error && !membership.error && project.data
      && (membership.data?.role === "admin" || (membership.data?.role === "engineer" && project.data.user_id === userId))) return;
  }
  throw new TakeoffError({
    status: 403,
    code: TakeoffErrorCode.FORBIDDEN,
    message: "Le créateur n’est plus autorisé à lancer un métré sur cette affaire.",
    retryable: false,
    jobId: id,
  });
}

export async function resolveTakeoffExecutionProvider(
  supabase: ServerSupabaseClient,
  job: TakeoffJobProcessingRow,
  resolveProvider: typeof resolveLocalTakeoffProvider,
): ReturnType<typeof resolveLocalTakeoffProvider> {
  if (job.estimate_version_id !== null) return resolveProvider(supabase, job);

  const assertAffaireAccess = () => assertAffaireTakeoffExecutionAccess(supabase, job);
  await assertAffaireAccess();
  const provider = await resolveProvider(supabase, job);
  return {
    ...provider,
    async assertOwnerActive() {
      await assertAffaireAccess();
      await provider.assertOwnerActive();
    },
    async call(options) {
      await assertAffaireAccess();
      return provider.call(options);
    },
  };
}
