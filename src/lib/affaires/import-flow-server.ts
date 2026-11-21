import type { SupabaseClient } from "@supabase/supabase-js";

import { affaireOwnerFilter, type AffaireAccessMode } from "@/lib/affaires/access-server";
import { readActiveTenantMembership, type TenantRole } from "@/lib/auth/tenant-context";
import type { Database, Json } from "@/types/database";

import type {
  ImportLaborRoleCandidate,
  ValidImportFlowItem,
  ValidImportFlowLine,
} from "@/lib/affaires/import-flow";
import { DEFAULT_TAX_RATE_BP } from "@/lib/estimates/constants";
import { applyMappingToPayload } from "@/lib/mappings/schemas";
import { asRecord } from "@/lib/value-guards";
import type { EstimateV3PricingStatus } from "@/lib/estimates/engine-v3";

export type Supabase = SupabaseClient<Database>;
export type TenantMembershipRow = Pick<
  Database["public"]["Tables"]["tenant_memberships"]["Row"],
  "tenant_id" | "role"
>;
export type ImportRow = Pick<
  Database["public"]["Tables"]["dpgf_imports"]["Row"],
  "id" | "tenant_id" | "user_id" | "project_id" | "filename" | "row_count"
>;
export type VersionComputationContext = {
  version_id: string | null;
  margin_multiplier: number;
  tax_rate_bp: number;
};

export const DEFAULT_MARGIN_MULTIPLIER = 1;
export { DEFAULT_TAX_RATE_BP };

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
  labor_role_id?: string | null;
  pu_ht_cents: number;
  line_total_ht_cents: number;
  line_tax_cents: number;
  line_total_ttc_cents: number;
  // Engine 3 only (2.8, D9, D4): absent from a v1/v2 payload, which stays unchanged.
  unit_code?: string | null;
  pricing_status?: EstimateV3PricingStatus;
  h_mo_per_unit?: number | null;
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
    .select("id, tenant_id, user_id, project_id, filename, row_count")
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

/** The affaire rule in `mode`, as a filter on the affaires of the tenant; refused like a missing affaire. */
export async function assertProjectAccessOrThrow(input: {
  supabase: Supabase;
  projectId: string;
  tenantId: string;
  userId: string;
  tenantRole: TenantRole;
  mode: AffaireAccessMode;
}): Promise<void> {
  let query = input.supabase
    .from("estimate_projects")
    .select("id")
    .eq("id", input.projectId)
    .eq("tenant_id", input.tenantId)
    .eq("is_archived", false);

  const owner = affaireOwnerFilter(input, input.mode);
  if (owner) {
    query = query.eq("user_id", owner);
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

/**
 * Active labour roles of the project owner: the creation RPC only accepts the owner's roles
 * (ESTIMATE_LABOR_ROLE_OWNER_MISMATCH), and imported hours are priced at the chosen role's rate.
 */
export async function fetchProjectOwnerLaborRoles(input: {
  supabase: Supabase;
  projectId: string;
  tenantId: string;
}): Promise<ImportLaborRoleCandidate[]> {
  const { data: project, error: projectError } = await input.supabase
    .from("estimate_projects")
    .select("user_id")
    .eq("id", input.projectId)
    .eq("tenant_id", input.tenantId)
    .maybeSingle();

  if (projectError) {
    throw new Error("Impossible de charger le projet cible.");
  }
  if (!project?.user_id) {
    return [];
  }

  const { data, error } = await input.supabase
    .from("labor_roles")
    .select("id, name, hourly_rate_cents")
    .eq("tenant_id", input.tenantId)
    .eq("user_id", project.user_id)
    .eq("is_active", true)
    .order("position", { ascending: true });

  if (error) {
    throw new Error("Impossible de charger les rôles de main-d'œuvre.");
  }

  return (data ?? []).map((role) => ({
    id: role.id,
    name: role.name,
    hourlyRateCents: role.hourly_rate_cents ?? 0,
  }));
}

export async function fetchMappedRowsForImport(input: {
  supabase: Supabase;
  importId: string;
  tenantId: string;
}) {
  const pageSize = 500;
  const rows: Array<{ id: string; payload: Json }> = [];
  const ids = new Set<string>();
  let expectedCount: number | null = null;

  for (let offset = 0; ; offset += pageSize) {
    const { data, error, count } = await input.supabase
      .from("dpgf_rows_mapped")
      .select("id, payload", { count: "exact" })
      .eq("tenant_id", input.tenantId)
      .eq("import_id", input.importId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      throw new Error("Impossible de charger les lignes mappées.");
    }
    if (count === null || !Number.isSafeInteger(count) || count < 0 ||
      (expectedCount !== null && count !== expectedCount)) {
      throw new Error("Les lignes mappées ont changé. Rechargez l'import avant de continuer.");
    }
    expectedCount = count;
    const batch = data ?? [];
    for (const row of batch) {
      if (ids.has(row.id)) {
        throw new Error("Les lignes mappées ont changé. Rechargez l'import avant de continuer.");
      }
      ids.add(row.id);
      rows.push({ id: row.id, payload: row.payload });
    }
    if (batch.length < pageSize) {
      if (rows.length !== expectedCount) {
        throw new Error("La lecture des lignes mappées est incomplète. Rechargez l'import avant de continuer.");
      }
      return rows;
    }
  }
}

export async function fetchLatestMapping(input: {
  supabase: Supabase;
  importId: string;
  tenantId: string;
}): Promise<{ id: string; columnMapping: unknown } | null> {
  const { data, error } = await input.supabase
    .from("dpgf_mappings")
    .select("id, column_mapping")
    .eq("tenant_id", input.tenantId)
    .eq("import_id", input.importId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("Impossible de charger le mapping.");
  }

  return data ? { id: data.id, columnMapping: data.column_mapping } : null;
}

/** What the member reads when the rows of the import are no longer those of the mapping they reviewed. */
export const IMPORT_MAPPING_CHANGED_MESSAGE =
  "Le mappage a changé dans un autre onglet : rechargez-le et vérifiez-le avant de confirmer.";

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonicalValue(entry)]));
  }
  return value;
}

/**
 * The rows a confirmation records are those its mapping made from the import's raw rows: one per raw row, all of
 * them, each the mapping applied to its raw row. Rows of another tab's mapping, or a replacement still being written,
 * refuse the confirmation before anything is written; the identifiers checked here are compared again under the
 * confirmation's lock (`record_dpgf_import_confirmation`).
 */
export function assertMappedRowsFollowMapping(
  rows: ReadonlyArray<{ id: string; payload: Json }>,
  input: { columnMapping: unknown; rowCount: number | null }
) {
  const columns = asRecord(input.columnMapping);
  const mapping = columns
    ? Object.fromEntries(Object.entries(columns).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : null;
  const rawRowIds = new Set<string>();
  for (const row of rows) {
    const payload = asRecord(row.payload);
    const raw = asRecord(payload?.raw_row);
    const mapped = asRecord(payload?.mapped_row);
    const rawRowId = typeof payload?.raw_row_id === "string" ? payload.raw_row_id : null;
    if (!mapping || !raw || !mapped || !rawRowId || rawRowIds.has(rawRowId)
      || JSON.stringify(canonicalValue(mapped)) !== JSON.stringify(canonicalValue(applyMappingToPayload(raw, mapping)))) {
      throw new Error(IMPORT_MAPPING_CHANGED_MESSAGE);
    }
    rawRowIds.add(rawRowId);
  }
  if (input.rowCount === null || rows.length !== input.rowCount) throw new Error(IMPORT_MAPPING_CHANGED_MESSAGE);
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
    labor_role_id: line.laborRoleId ?? null,
    pu_ht_cents: line.puHtCents,
    line_total_ht_cents: line.lineTotalHtCents,
    line_tax_cents: line.lineTaxCents,
    line_total_ttc_cents: line.lineTotalTtcCents,
    ...(line.pricingStatus !== undefined
      ? { unit_code: line.unitCode ?? null, pricing_status: line.pricingStatus, h_mo_per_unit: line.hoursPerUnit ?? null }
      : {}),
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
