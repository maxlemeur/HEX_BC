import "server-only";

import { createHash } from "node:crypto";

import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { readAllRows } from "@/lib/supabase/read-all";

/** Fresh DB stamps bypass React caches and Next's same-request GET deduplication. */
export async function readCockpitDecisionFingerprint(context: AuthenticatedTenantContext, projectId: string): Promise<string | null> {
  const specifications = [
    { table: "estimate_projects", projectColumn: "id", columns: "id,updated_at" },
    { table: "estimate_versions", projectColumn: "project_id", columns: "id,updated_at,content_revision,status" },
    { table: "affaire_intake_documents", projectColumn: "project_id", columns: "id,updated_at" },
    { table: "affaire_intake_uploads", projectColumn: "project_id", columns: "id,updated_at" },
    { table: "affaire_briefs", projectColumn: "project_id", columns: "id,updated_at" },
    { table: "affaire_register_entries", projectColumn: "project_id", columns: "id,updated_at" },
    { table: "plan_sets", projectColumn: "project_id", columns: "id,updated_at" },
    { table: "plan_files", projectColumn: "plan_sets.project_id", columns: "id,updated_at,plan_sets!inner(project_id)" },
    { table: "takeoff_jobs", projectColumn: "estimate_versions.project_id", columns: "id,updated_at,estimate_versions!inner(project_id)" },
    { table: "cockpit_command_preferences", projectColumn: "project_id", columns: "id,updated_at", userOnly: true },
    { table: "tenant_memberships", columns: "id,updated_at,tenants!inner(is_active)", userOnly: true },
    { table: "feature_flags", columns: "id,updated_at" },
  ];
  try {
    const rows = await Promise.all(specifications.map(async (specification) => {
      const result = await readAllRows(() => {
        let query = context.supabase.from(specification.table as never)
          .select(specification.columns as never, { count: "exact" })
          .eq("tenant_id" as never, context.tenantId as never)
          .abortSignal(new AbortController().signal);
        if (specification.projectColumn) query = query.eq(specification.projectColumn as never, projectId as never);
        if (specification.userOnly) query = query.eq("user_id" as never, context.userId as never);
        return query;
      });
      if (result.error || (specification.table === "estimate_projects" || specification.table === "tenant_memberships") && !result.data?.length) {
        throw new Error("Le contexte du cockpit n’est plus accessible.");
      }
      return { table: specification.table, rows: result.data };
    }));
    return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  } catch {
    // An incomplete or inaccessible state cannot validate a stale recommendation.
    return null;
  }
}
