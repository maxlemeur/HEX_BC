import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

import type { ValidImportFlowLine } from "@/lib/affaires/import-flow";

export type Supabase = SupabaseClient<Database>;
export type TenantMembershipRow = Pick<
  Database["public"]["Tables"]["tenant_memberships"]["Row"],
  "tenant_id" | "role"
>;
export type ImportRow = Pick<
  Database["public"]["Tables"]["dpgf_imports"]["Row"],
  "id" | "tenant_id" | "user_id" | "project_id"
>;
export type VersionComputationContext = {
  version_id: string | null;
  margin_multiplier: number;
  tax_rate_bp: number;
};

export const DEFAULT_MARGIN_MULTIPLIER = 1;
export const DEFAULT_TAX_RATE_BP = 2000;

export type RpcImportLinesPayload = {
  mapped_row_id: string;
  row_index: number;
  title: string;
  description: string | null;
  quantity: number;
  unit_price_ht_cents: number;
  tax_rate_bp: number;
  k_fo: number;
  h_mo: number;
  h_mo_majoration: number;
  k_mo: number;
  pu_ht_cents: number;
  line_total_ht_cents: number;
  line_tax_cents: number;
  line_total_ttc_cents: number;
};

export function normalizeNullableText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function getCurrentMembershipOrThrow(
  supabase: Supabase,
  userId: string
): Promise<TenantMembershipRow> {
  const { data, error } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, role, is_default, created_at")
    .eq("user_id", userId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    throw new Error("Impossible de charger le tenant courant.");
  }

  const membership = data?.[0] as TenantMembershipRow | undefined;
  if (!membership) {
    throw new Error("Aucun tenant actif pour cet utilisateur.");
  }

  return membership;
}

export async function getImportOrThrow(input: {
  supabase: Supabase;
  importId: string;
  tenantId: string;
  userId: string;
  isTenantAdmin: boolean;
}): Promise<ImportRow> {
  let query = input.supabase
    .from("dpgf_imports")
    .select("id, tenant_id, user_id, project_id")
    .eq("id", input.importId)
    .eq("tenant_id", input.tenantId);

  if (!input.isTenantAdmin) {
    query = query.eq("user_id", input.userId);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new Error("Impossible de charger l'import.");
  }
  if (!data) {
    throw new Error("Import introuvable ou non autorise.");
  }

  return data as ImportRow;
}

export async function assertProjectAccessOrThrow(input: {
  supabase: Supabase;
  projectId: string;
  tenantId: string;
  userId: string;
  isTenantAdmin: boolean;
}): Promise<void> {
  let query = input.supabase
    .from("estimate_projects")
    .select("id")
    .eq("id", input.projectId)
    .eq("tenant_id", input.tenantId)
    .eq("is_archived", false);

  if (!input.isTenantAdmin) {
    query = query.eq("user_id", input.userId);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new Error("Impossible de verifier le projet cible.");
  }
  if (!data) {
    throw new Error("Projet cible introuvable ou non autorise.");
  }
}

export async function ensureImportProjectLink(input: {
  supabase: Supabase;
  importId: string;
  projectId: string;
  tenantId: string;
  userId: string;
  isTenantAdmin: boolean;
}): Promise<void> {
  let query = input.supabase
    .from("dpgf_imports")
    .update({ project_id: input.projectId })
    .eq("id", input.importId)
    .eq("tenant_id", input.tenantId);

  if (!input.isTenantAdmin) {
    query = query.eq("user_id", input.userId);
  }

  const { data, error } = await query.select("id").maybeSingle();
  if (error) {
    throw new Error("Impossible de lier l'import au projet.");
  }
  if (!data) {
    throw new Error("Import introuvable ou non autorise.");
  }
}

export async function fetchVersionComputationContext(
  supabase: Supabase,
  projectId: string,
  tenantId: string
): Promise<VersionComputationContext> {
  const { data, error } = await supabase
    .from("estimate_versions")
    .select("id, margin_multiplier, tax_rate_bp")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("Impossible de charger les parametres de version.");
  }

  return {
    version_id: data?.id ?? null,
    margin_multiplier: data?.margin_multiplier ?? DEFAULT_MARGIN_MULTIPLIER,
    tax_rate_bp: data?.tax_rate_bp ?? DEFAULT_TAX_RATE_BP,
  };
}

export async function fetchMappedRowsForImport(input: {
  supabase: Supabase;
  importId: string;
  tenantId: string;
}) {
  const { data, error } = await input.supabase
    .from("dpgf_rows_mapped")
    .select("id, payload")
    .eq("tenant_id", input.tenantId)
    .eq("import_id", input.importId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    throw new Error("Impossible de charger les lignes mappees.");
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    payload: row.payload,
  }));
}

export async function fetchLatestMappingId(input: {
  supabase: Supabase;
  importId: string;
  tenantId: string;
}): Promise<string | null> {
  const { data, error } = await input.supabase
    .from("dpgf_mappings")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .eq("import_id", input.importId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("Impossible de charger le mapping.");
  }

  return data?.id ?? null;
}

export function sortValidLinesForEstimateCreation(lines: ValidImportFlowLine[]): ValidImportFlowLine[] {
  return [...lines].sort((left, right) => {
    if (left.rowIndex !== right.rowIndex) {
      return left.rowIndex - right.rowIndex;
    }

    return left.mappedRowId.localeCompare(right.mappedRowId);
  });
}

export function toRpcImportLines(lines: ValidImportFlowLine[]): RpcImportLinesPayload[] {
  return lines.map((line) => ({
    mapped_row_id: line.mappedRowId,
    row_index: line.rowIndex,
    title: line.title,
    description: line.description,
    quantity: line.quantity,
    unit_price_ht_cents: line.unitPriceHtCents,
    tax_rate_bp: line.taxRateBp,
    k_fo: line.kFo,
    h_mo: line.hMo,
    h_mo_majoration: line.hMoMajoration,
    k_mo: line.kMo,
    pu_ht_cents: line.puHtCents,
    line_total_ht_cents: line.lineTotalHtCents,
    line_tax_cents: line.lineTaxCents,
    line_total_ttc_cents: line.lineTotalTtcCents,
  }));
}
