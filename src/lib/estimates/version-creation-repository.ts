import "server-only";

import {
  isCalculationContextConflict,
  mapSupabaseError,
  notFound,
} from "@/lib/estimates/errors";
import {
  canAccessOwnerResource,
  type AuthenticatedContext,
} from "@/lib/estimates/server-context";
import {
  buildDefaultEstimateCategories,
  buildMissingDefaultEstimateLaborRoles,
  defaultEstimateLaborRoleNames,
} from "@/lib/estimates/version-creation-plan";
import type { Database } from "@/types/database";

type Supabase = AuthenticatedContext["supabase"];
type EstimateVersionRow = Database["public"]["Tables"]["estimate_versions"]["Row"];
export type CreateEstimateLatestVersionDefaultsRow = Pick<
  EstimateVersionRow,
  | "id"
  | "version_number"
  | "date_devis"
  | "validite_jours"
  | "margin_multiplier"
  | "margin_mode"
  | "currency"
  | "margin_bp"
  | "discount_bp"
  | "discount_amount_cents"
  | "discount_mode"
  | "discount_steps"
  | "global_coefficient"
  | "tax_rate_bp"
  | "rounding_mode"
  | "rounding_step_cents"
  | "max_section_depth"
>;

export async function loadEstimateCreationProject(
  context: AuthenticatedContext,
  projectId: string
) {
  const { supabase, tenantId } = context;
  const { data: project, error } = await supabase
    .from("estimate_projects")
    .select("*")
    .eq("id", projectId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) {
    throw mapSupabaseError(error, "Impossible de charger le projet de chiffrage.");
  }
  if (!project || project.is_archived || !canAccessOwnerResource({
    context,
    resourceUserId: project.user_id,
  })) {
    throw notFound("Projet de chiffrage introuvable.");
  }

  const { data, error: latestVersionError } = await supabase
    .from("estimate_versions")
    .select(
      "id, version_number, date_devis, validite_jours, margin_multiplier, margin_mode, currency, margin_bp, discount_bp, discount_amount_cents, discount_mode, discount_steps, global_coefficient, tax_rate_bp, rounding_mode, rounding_step_cents, max_section_depth"
    )
    .eq("tenant_id", tenantId)
    .eq("project_id", project.id)
    .order("version_number", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestVersionError) {
    throw mapSupabaseError(latestVersionError, "Impossible de charger la version courante du projet.");
  }
  return {
    project,
    latestVersionDefaults: (data ?? null) as CreateEstimateLatestVersionDefaultsRow | null,
  };
}

export async function ensureDefaultEstimateCategories(input: {
  supabase: Supabase;
  tenantId: string;
  userId: string;
}) {
  const { error } = await input.supabase
    .from("estimate_categories")
    .upsert(buildDefaultEstimateCategories(input), {
      onConflict: "tenant_id,user_id,name",
      ignoreDuplicates: true,
    });
  if (error) {
    throw mapSupabaseError(error, "Impossible de préparer les catégories par défaut.");
  }
}

const DEFAULT_LABOR_ROLES_RETRY_DELAY_MS = 150;

/**
 * Every proposed role try-locks the tenant calculation gate, including skipped
 * upserts: only write missing defaults. Retry a refused gate once from a fresh
 * read; any residual refusal remains a retryable 409.
 */
export async function ensureDefaultLaborRoles(input: {
  supabase: Supabase;
  tenantId: string;
  ownerUserId: string;
}) {
  const defaultNames = defaultEstimateLaborRoleNames();
  for (let attempt = 1; ; attempt += 1) {
    const { data, error } = await input.supabase
      .from("labor_roles")
      .select("name")
      .eq("tenant_id", input.tenantId)
      .eq("user_id", input.ownerUserId)
      .in("name", defaultNames);
    if (error) {
      throw mapSupabaseError(error, "Impossible de préparer les rôles MO par défaut.");
    }

    const payload = buildMissingDefaultEstimateLaborRoles({
      tenantId: input.tenantId,
      ownerUserId: input.ownerUserId,
      existingNames: new Set((data ?? []).map((role) => role.name)),
    });
    if (payload.length === 0) return;

    const { error: insertError } = await input.supabase
      .from("labor_roles")
      .upsert(payload, {
        onConflict: "tenant_id,user_id,name",
        ignoreDuplicates: true,
      });
    if (!insertError) return;
    if (attempt === 1 && isCalculationContextConflict(insertError)) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, DEFAULT_LABOR_ROLES_RETRY_DELAY_MS);
      });
      continue;
    }
    throw mapSupabaseError(insertError, "Impossible de préparer les rôles MO par défaut.");
  }
}
