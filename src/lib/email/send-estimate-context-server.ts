import "server-only";
import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { internalError, mapSupabaseError, notFound } from "@/lib/estimates/errors";
import { assertCanWriteEstimateWorkflows } from "@/lib/estimates/write-access";
import type { Database } from "@/types/database";

type EstimateProjectRow = Database["public"]["Tables"]["estimate_projects"]["Row"];
type EstimateVersionRow = Database["public"]["Tables"]["estimate_versions"]["Row"];
type EstimateVersionForEmail = Pick<
  EstimateVersionRow,
  | "id"
  | "tenant_id"
  | "version_number"
  | "total_ttc_cents"
  | "currency"
  | "status"
  | "updated_at"
  | "content_revision"
  | "calc_engine_version"
> & {
  estimate_projects:
    | Pick<EstimateProjectRow, "name" | "estimate_reference">
    | Pick<EstimateProjectRow, "name" | "estimate_reference">[]
    | null;
};

export function getRequiredEnvVar(name: "RESEND_API_KEY" | "EMAIL_FROM") {
  const value = process.env[name]?.trim();
  if (!value) {
    throw internalError(`Configuration email manquante: ${name}.`);
  }
  return value;
}

export async function loadVersionForEmail(versionId: string) {
  const context = await getAuthenticatedTenantContext();
  assertCanWriteEstimateWorkflows(context.tenantRole);

  const { data, error } = await context.supabase
    .from("estimate_versions")
    .select(
      "id, tenant_id, version_number, total_ttc_cents, currency, status, updated_at, content_revision, calc_engine_version, estimate_projects(name, estimate_reference)"
    )
    .eq("id", versionId)
    .eq("tenant_id", context.tenantId)
    .single();

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger la version de devis.");
  }
  if (!data) {
    throw notFound("Version de devis introuvable.");
  }

  return {
    context,
    version: data as EstimateVersionForEmail,
  };
}
