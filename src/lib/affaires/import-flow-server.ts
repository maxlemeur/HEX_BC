import type { SupabaseClient } from "@supabase/supabase-js";

import { readActiveTenantMembership } from "@/lib/auth/tenant-context";
import type { Database, Json } from "@/types/database";

import type {
  ValidImportFlowItem,
  ValidImportFlowLine,
} from "@/lib/affaires/import-flow";

export type Supabase = SupabaseClient<Database>;
export type TenantMembershipRow = Pick<
  Database["public"]["Tables"]["tenant_memberships"]["Row"],
  "tenant_id" | "role"
>;
export type ImportRow = Pick<
  Database["public"]["Tables"]["dpgf_imports"]["Row"],
  "id" | "tenant_id" | "user_id" | "project_id" | "filename"
>;
export type VersionComputationContext = {
  version_id: string | null;
  margin_multiplier: number;
  tax_rate_bp: number;
};

export const DEFAULT_MARGIN_MULTIPLIER = 1;
export const DEFAULT_TAX_RATE_BP = 2000;

export type RpcImportLinesPayload = {
  item_type: "line";
  mapped_row_id: string;
  row_index: number;
  title: string;
  description: string | null;
  notes: string | null;
  source_page: number | null;
  source_metadata: Json;
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

export type RpcImportSectionPayload = {
  item_type: "section";
  mapped_row_id: string;
  row_index: number;
  title: string;
  section_level: 1 | 2;
  source_page: number | null;
  source_metadata: Json;
};

type RpcImportProvenance = {
  importId: string;
  mappingId: string | null;
};

function toRpcSourceMetadata(
  sourceMetadata: Record<string, unknown>,
  provenance?: RpcImportProvenance
): Json {
  if (!provenance) return sourceMetadata as Json;

  return {
    ...sourceMetadata,
    import_id: provenance.importId,
    mapping_id: provenance.mappingId,
  } as Json;
}

export type RpcImportItemPayload = RpcImportLinesPayload | RpcImportSectionPayload;

export function normalizeNullableText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function getCurrentMembershipOrThrow(
  supabase: Supabase,
  userId: string
): Promise<TenantMembershipRow> {
  const { membership, error } = await readActiveTenantMembership(supabase, userId);

  if (error) {
    throw new Error("Impossible de charger le tenant courant.");
  }

  if (!membership) {
    throw new Error("Aucun tenant actif pour cet utilisateur.");
  }

  return {
    tenant_id: membership.tenant_id,
    role: membership.role,
  };
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
    .select("id, tenant_id, user_id, project_id, filename")
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
    throw new Error("Impossible de vérifier le projet cible.");
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
    throw new Error("Impossible de charger les paramètres de version.");
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
    item_type: "line",
    mapped_row_id: line.mappedRowId,
    row_index: line.rowIndex,
    title: line.title,
    description: line.description,
    notes: line.notes,
    source_page: line.sourcePage,
    source_metadata: line.sourceMetadata as Json,
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

export function toRpcImportItems(
  items: ValidImportFlowItem[],
  provenance?: RpcImportProvenance
): RpcImportItemPayload[] {
  return items.map((item) => {
    if (item.itemType === "line") {
      const payload = toRpcImportLines([item])[0]!;
      return {
        ...payload,
        source_metadata: toRpcSourceMetadata(item.sourceMetadata, provenance),
      };
    }

    return {
      item_type: "section",
      mapped_row_id: item.mappedRowId,
      row_index: item.rowIndex,
      title: item.title,
      section_level: item.level,
      source_page: item.sourcePage,
      source_metadata: toRpcSourceMetadata(item.sourceMetadata, provenance),
    };
  });
}
