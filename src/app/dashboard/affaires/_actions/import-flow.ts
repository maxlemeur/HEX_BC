"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  buildImportFlowStats,
  normalizeMappedRowsForEstimateCreation,
  type ValidImportFlowLine,
} from "@/lib/affaires/import-flow";
import { createMapping } from "@/lib/mappings/server";
import { mappingRecordSchema } from "@/lib/mappings/schemas";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type Supabase = SupabaseClient<Database>;
type TenantMembershipRow = Pick<
  Database["public"]["Tables"]["tenant_memberships"]["Row"],
  "tenant_id" | "role"
>;

type ImportRow = Pick<
  Database["public"]["Tables"]["dpgf_imports"]["Row"],
  "id" | "tenant_id" | "user_id" | "project_id"
>;

type VersionComputationContext = Pick<
  Database["public"]["Tables"]["estimate_versions"]["Row"],
  "margin_multiplier" | "tax_rate_bp"
>;

export type ConfirmUnifiedImportFlowMode = "mapping_only" | "version_created";

export type ConfirmUnifiedImportFlowResult = {
  mode: ConfirmUnifiedImportFlowMode;
  importId: string;
  projectId: string | null;
  mappingId: string | null;
  versionId: string | null;
  redirectTo: string | null;
  stats: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    insertedRows: number;
    skippedRows: number;
  };
};

type RpcCreateVersionResultRow = {
  version_id: string;
  section_id: string;
  inserted_count: number;
  total_ht_cents: number;
  total_tax_cents: number;
  total_ttc_cents: number;
};

const DEFAULT_MARGIN_MULTIPLIER = 1;
const DEFAULT_TAX_RATE_BP = 2000;

const confirmUnifiedImportFlowSchema = z.object({
  importId: z.string().uuid("importId invalide."),
  projectId: z.string().uuid("projectId invalide.").nullable().optional(),
  mapping: z.record(z.string(), z.union([z.string(), z.null()])).optional(),
  createEstimate: z.boolean(),
  versionTitle: z.string().trim().max(200).nullable().optional(),
  sectionTitle: z.string().trim().max(200).nullable().optional(),
});
export type ConfirmUnifiedImportFlowInput = z.infer<typeof confirmUnifiedImportFlowSchema>;

function normalizeNullableText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function getCurrentMembershipOrThrow(
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

async function getImportOrThrow(input: {
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

async function assertProjectAccessOrThrow(input: {
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

async function ensureImportProjectLink(input: {
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

function toRpcLines(lines: ValidImportFlowLine[]) {
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

async function fetchVersionComputationContext(
  supabase: Supabase,
  projectId: string,
  tenantId: string
): Promise<VersionComputationContext> {
  const { data, error } = await supabase
    .from("estimate_versions")
    .select("margin_multiplier, tax_rate_bp")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("Impossible de charger les parametres de version.");
  }

  return {
    margin_multiplier: data?.margin_multiplier ?? DEFAULT_MARGIN_MULTIPLIER,
    tax_rate_bp: data?.tax_rate_bp ?? DEFAULT_TAX_RATE_BP,
  };
}

async function fetchMappedRowsForImport(input: {
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

function sortValidLinesForEstimateCreation(lines: ValidImportFlowLine[]): ValidImportFlowLine[] {
  return [...lines].sort((left, right) => {
    if (left.rowIndex !== right.rowIndex) {
      return left.rowIndex - right.rowIndex;
    }

    return left.mappedRowId.localeCompare(right.mappedRowId);
  });
}

async function fetchLatestMappingId(input: {
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

async function createVersionFromMappedRows(input: {
  supabase: Supabase;
  importId: string;
  projectId: string;
  versionTitle: string | null;
  sectionTitle: string | null;
  lines: ValidImportFlowLine[];
}) {
  const { data, error } = await input.supabase.rpc("create_estimate_version_from_import_lines", {
    p_project_id: input.projectId,
    p_import_id: input.importId,
    p_version_title: input.versionTitle,
    p_section_title: input.sectionTitle,
    p_lines: toRpcLines(input.lines),
  });

  if (error) {
    throw new Error("Impossible de creer la version depuis l'import.");
  }

  const row = Array.isArray(data) ? (data[0] as RpcCreateVersionResultRow | undefined) : undefined;
  if (!row?.version_id) {
    throw new Error("La creation de version a retourne une reponse invalide.");
  }

  return row;
}

function revalidateImportFlowPaths(projectId: string | null, versionId: string | null) {
  revalidatePath("/dashboard/imports");
  revalidatePath("/dashboard/mappings");
  revalidatePath("/dashboard/estimates");
  revalidatePath("/dashboard/affaires");

  if (projectId) {
    revalidatePath(`/dashboard/affaires/${projectId}`);
  }

  if (versionId) {
    revalidatePath(`/dashboard/estimates/${versionId}/edit`);
  }
}

export async function confirmUnifiedImportFlow(
  input: ConfirmUnifiedImportFlowInput
): Promise<ConfirmUnifiedImportFlowResult> {
  const parsed = confirmUnifiedImportFlowSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Payload de confirmation invalide.");
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error("Authentification requise.");
  }

  const membership = await getCurrentMembershipOrThrow(supabase, user.id);
  const isTenantAdmin = membership.role === "admin";
  const requestedProjectId = parsed.data.projectId ?? null;

  if (parsed.data.createEstimate && !requestedProjectId) {
    throw new Error("projectId est requis pour creer un chiffrage.");
  }

  const importRow = await getImportOrThrow({
    supabase,
    importId: parsed.data.importId,
    tenantId: membership.tenant_id,
    userId: user.id,
    isTenantAdmin,
  });

  if (
    requestedProjectId &&
    importRow.project_id &&
    importRow.project_id !== requestedProjectId
  ) {
    throw new Error("Cet import est deja lie a une autre affaire.");
  }

  if (requestedProjectId) {
    await assertProjectAccessOrThrow({
      supabase,
      projectId: requestedProjectId,
      tenantId: membership.tenant_id,
      userId: user.id,
      isTenantAdmin,
    });

    if (!importRow.project_id) {
      await ensureImportProjectLink({
        supabase,
        importId: importRow.id,
        projectId: requestedProjectId,
        tenantId: membership.tenant_id,
        userId: user.id,
        isTenantAdmin,
      });
    }
  }

  const normalizedMapping = mappingRecordSchema.parse(parsed.data.mapping ?? {});
  let mappingId: string | null = null;

  if (Object.keys(normalizedMapping).length > 0) {
    const createMappingResult = await createMapping({
      import_id: parsed.data.importId,
      mapping: normalizedMapping,
      save_template: false,
    });
    mappingId = createMappingResult.mapping.id;
  }

  if (!mappingId) {
    mappingId = await fetchLatestMappingId({
      supabase,
      importId: parsed.data.importId,
      tenantId: membership.tenant_id,
    });
  }

  const effectiveProjectId = requestedProjectId ?? importRow.project_id ?? null;
  const mappedRows = await fetchMappedRowsForImport({
    supabase,
    importId: parsed.data.importId,
    tenantId: membership.tenant_id,
  });

  const versionContext = effectiveProjectId
    ? await fetchVersionComputationContext(
        supabase,
        effectiveProjectId,
        membership.tenant_id
      )
    : {
        margin_multiplier: DEFAULT_MARGIN_MULTIPLIER,
        tax_rate_bp: DEFAULT_TAX_RATE_BP,
      };

  const normalizedRows = normalizeMappedRowsForEstimateCreation(mappedRows, {
    marginMultiplier: versionContext.margin_multiplier,
    defaultTaxRateBp: versionContext.tax_rate_bp,
  });

  if (parsed.data.createEstimate && normalizedRows.validLines.length === 0) {
    throw new Error("Aucune ligne valide a inserer pour creer le chiffrage.");
  }

  if (!parsed.data.createEstimate) {
    const stats = buildImportFlowStats(normalizedRows, 0);
    revalidateImportFlowPaths(effectiveProjectId, null);

    return {
      mode: "mapping_only",
      importId: parsed.data.importId,
      projectId: effectiveProjectId,
      mappingId,
      versionId: null,
      redirectTo: null,
      stats,
    };
  }

  const projectId = requestedProjectId;
  if (!projectId) {
    throw new Error("projectId est requis pour creer un chiffrage.");
  }

  const createdVersion = await createVersionFromMappedRows({
    supabase,
    importId: parsed.data.importId,
    projectId,
    versionTitle: normalizeNullableText(parsed.data.versionTitle),
    sectionTitle: normalizeNullableText(parsed.data.sectionTitle),
    lines: sortValidLinesForEstimateCreation(normalizedRows.validLines),
  });

  const stats = buildImportFlowStats(normalizedRows, createdVersion.inserted_count);
  const redirectTo = `/dashboard/estimates/${createdVersion.version_id}/edit`;

  revalidateImportFlowPaths(projectId, createdVersion.version_id);

  return {
    mode: "version_created",
    importId: parsed.data.importId,
    projectId,
    mappingId,
    versionId: createdVersion.version_id,
    redirectTo,
    stats,
  };
}
