import type { SupabaseClient } from "@supabase/supabase-js";

import { getVersionAccessOrThrow } from "@/lib/estimates/server-context";
import type { Database } from "@/types/database";

type Supabase = SupabaseClient<Database>;
type EstimateProject = Database["public"]["Tables"]["estimate_projects"]["Row"];
type EstimateVersion = Database["public"]["Tables"]["estimate_versions"]["Row"];
type TenantRole = Database["public"]["Enums"]["tenant_role"];

export type AiDraftProject = Pick<
  EstimateProject,
  "id" | "tenant_id" | "user_id" | "name" | "reference" | "client_name" | "notes" | "is_archived"
>;

export type AiDraftVersion = Pick<
  EstimateVersion,
  "id" | "project_id" | "status" | "margin_multiplier" | "tax_rate_bp" | "updated_at" | "calc_engine_version"
>;

export function readAiDraftTarget(
  context: { supabase: Supabase; userId: string; tenantId: string; tenantRole: TenantRole },
  versionId: string
) {
  return getVersionAccessOrThrow<AiDraftVersion, AiDraftProject>(context.supabase, versionId, context, {
    mode: "owner_or_admin_on_active_project",
    versionColumns: "id, project_id, status, margin_multiplier, tax_rate_bp, updated_at, calc_engine_version",
    projectColumns: "name, reference, client_name, notes",
  });
}

export function confirmedAiDraftBrief(supabase: Supabase, projectId: string) {
  return supabase.from("affaire_briefs")
    .select("id, tenant_id, project_id, status, summary, project_object, scope, lots, received_pieces, assumptions, vigilance_points, missing_elements, updated_at")
    .eq("project_id", projectId)
    .eq("status", "confirme");
}
