import { readAllRows, readAllRowsInChunks } from "@/lib/supabase/read-all";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import { loadValidLaborRoleIdsForOwner } from "@/lib/estimates/estimate-assembly-helpers";
import { badRequest, conflict, mapSupabaseError, notFound } from "@/lib/estimates/errors";
import type { Database } from "@/types/database";

type Supabase = SupabaseClient<Database>;
type EstimateTemplateRow = Database["public"]["Tables"]["estimate_templates"]["Row"];
type EstimateTemplateItemRow = Database["public"]["Tables"]["estimate_template_items"]["Row"];
type EstimateAssemblyRow = Database["public"]["Tables"]["estimate_assemblies"]["Row"];

export function throwTemplateNameConflictIfNeeded(error: PostgrestError): never | void {
  if (error.code !== "23505") return;
  throw conflict(
    "Un template avec ce nom existe déjà.",
    error,
    "ESTIMATE_TEMPLATE_NAME_CONFLICT"
  );
}

export function throwAssemblyNameConflictIfNeeded(error: PostgrestError): never | void {
  if (error.code !== "23505") return;
  throw conflict(
    "Un ouvrage avec ce nom existe déjà.",
    error,
    "ESTIMATE_ASSEMBLY_NAME_CONFLICT"
  );
}

export function errorMessageContains(
  error: PostgrestError,
  expectedMessageFragment: string
): boolean {
  return (error.message ?? "")
    .toLowerCase()
    .includes(expectedMessageFragment.toLowerCase());
}

export function throwAssemblyCompositionErrorIfNeeded(
  error: PostgrestError
): never | void {
  if (errorMessageContains(error, "would create a cycle")) {
    throw conflict(
      "Cette composition creerait une boucle entre ouvrages.",
      error,
      "ESTIMATE_ASSEMBLY_CYCLE"
    );
  }
  if (errorMessageContains(error, "limited to two nested levels")) {
    throw badRequest(
      "Un ouvrage est limite a deux niveaux de sous-ouvrages.",
      error,
      "ESTIMATE_ASSEMBLY_DEPTH_EXCEEDED"
    );
  }
  if (errorMessageContains(error, "cannot contain itself")) {
    throw badRequest(
      "Un ouvrage ne peut pas se contenir lui-même.",
      error,
      "ESTIMATE_ASSEMBLY_SELF_REFERENCE"
    );
  }
}


export function throwTemplateSourceVersionNotFoundIfNeeded(
  error: PostgrestError
): never | void {
  if (!errorMessageContains(error, "template source version not found")) return;
  throw notFound(
    "Version source introuvable.",
    error,
    "ESTIMATE_TEMPLATE_SOURCE_VERSION_NOT_FOUND"
  );
}

export function throwTemplateNotFoundIfNeeded(error: PostgrestError): never | void {
  if (!errorMessageContains(error, "template not found")) return;
  throw notFound("Template introuvable.", error, "ESTIMATE_TEMPLATE_NOT_FOUND");
}

export function toRpcUuid(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function toTemplateSummary(row: EstimateTemplateRow, itemCount: number) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    source_version_id: row.source_version_id,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    item_count: itemCount,
  };
}

export function toAssemblySummary(
  row: EstimateAssemblyRow,
  itemCount: number,
  memberCount = 0
) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    reference_code: row.reference_code,
    unit: row.unit,
    pricing_source: row.pricing_source,
    ds_cents: row.ds_cents,
    indicative_target_price_cents: row.indicative_target_price_cents,
    avg_output_rate: row.avg_output_rate,
    avg_time_hours: row.avg_time_hours,
    source_metadata: row.source_metadata,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    item_count: itemCount,
    member_count: memberCount,
  };
}

export async function loadEstimateTemplateOrThrow(input: {
  supabase: Supabase;
  tenantId: string;
  templateId: string;
}): Promise<EstimateTemplateRow> {
  const { data, error } = await input.supabase
    .from("estimate_templates")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .eq("id", input.templateId)
    .single();

  if (error || !data) {
    if (error && error.code !== "PGRST116") {
      throw mapSupabaseError(error, "Impossible de charger le template.");
    }

    throw notFound(
      "Template introuvable.",
      undefined,
      "ESTIMATE_TEMPLATE_NOT_FOUND"
    );
  }

  return data as unknown as EstimateTemplateRow;
}

export async function loadEstimateTemplateItems(input: {
  supabase: Supabase;
  tenantId: string;
  templateId: string;
}) {
  const { data, error } = await readAllRows(() => input.supabase
    .from("estimate_template_items")
    .select("*", { count: "exact" })
    .eq("tenant_id", input.tenantId)
    .eq("template_id", input.templateId)
    .order("position", { ascending: true })
    .order("id", { ascending: true }));

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les lignes du template.");
  }

  return (data ?? []) as EstimateTemplateItemRow[];
}

export async function loadTemplateLineCountByTemplateId(input: {
  supabase: Supabase;
  tenantId: string;
  templateIds: string[];
}) {
  const counts = new Map<string, number>();

  if (input.templateIds.length === 0) {
    return counts;
  }

  const { data, error } = await readAllRowsInChunks(input.templateIds, (pageIds) => input.supabase
    .from("estimate_template_items")
    .select("template_id, id", { count: "exact" })
    .eq("tenant_id", input.tenantId)
    .eq("item_type", "line")
    .in("template_id", pageIds));

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger le comptage des templates.");
  }

  for (const row of (data ?? []) as Array<{ template_id: string }>) {
    counts.set(row.template_id, (counts.get(row.template_id) ?? 0) + 1);
  }

  return counts;
}

/**
 * Lot 2, sous-lot 2.8 (rule 3, P-12), partagé depuis 2.10a avec la création depuis un modèle : une ligne qui
 * porte des heures sans quantité n'a pas d'heures par unité en moteur 3 (refus nommé de M6).
 */
export function templateHoursWithoutQuantityMessage(title: string) {
  return `La ligne « ${title} » du modèle porte des heures sans quantité : un chiffrage moteur 3 stocke des heures par unité. Renseignez sa quantité dans le modèle.`;
}

type TemplateLaborRoleItem = Partial<Pick<
  EstimateTemplateItemRow,
  "id" | "title" | "labor_role_id" | "labor_role_atelier_id" | "labor_role_chantier_id"
>>;

/**
 * Lot 2, sous-lot 2.8 (review), partagé depuis 2.10a : dans une v3, un rôle MO du modèle qui n'est pas un rôle du
 * propriétaire du devis serait valorisé à 0 €/h sans un mot par le moteur, puis refusé par toute écriture
 * TypeScript suivante. Refus nommé, à l'insertion comme à la création depuis le modèle.
 */
export async function assertTemplateLaborRolesOwnedForV3(input: {
  supabase: Supabase;
  tenantId: string;
  projectUserId: string;
  templateItems: readonly TemplateLaborRoleItem[];
}) {
  const rolesOf = (item: TemplateLaborRoleItem) =>
    [item.labor_role_id, item.labor_role_atelier_id, item.labor_role_chantier_id].filter((id): id is string => Boolean(id));
  const validRoles = await loadValidLaborRoleIdsForOwner({
    supabase: input.supabase, tenantId: input.tenantId, ownerUserId: input.projectUserId,
    laborRoleIds: input.templateItems.flatMap(rolesOf),
  });
  const offending = input.templateItems.filter((item) => rolesOf(item).some((id) => !validRoles.has(id)));
  if (offending.length === 0) return;

  throw badRequest(
    "Ce modèle porte des rôles de main-d'œuvre qui ne sont pas ceux du propriétaire du devis : un chiffrage moteur 3 compterait leurs heures à 0 €/h. Remplacez-les dans le modèle avant de l'insérer.",
    { items: offending.map((item) => ({ id: item.id, title: item.title ?? "Ligne sans titre" })) },
    "ESTIMATE_TEMPLATE_LABOR_ROLE_REQUIRED"
  );
}
