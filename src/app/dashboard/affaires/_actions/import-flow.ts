"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  buildImportFlowStats,
  normalizeMappedRowsForEstimateCreation,
} from "@/lib/affaires/import-flow";
import {
  type Supabase,
  type RpcImportLinesPayload,
  DEFAULT_MARGIN_MULTIPLIER,
  DEFAULT_TAX_RATE_BP,
  assertProjectAccessOrThrow,
  ensureImportProjectLink,
  fetchLatestMappingId,
  fetchMappedRowsForImport,
  fetchVersionComputationContext,
  getCurrentMembershipOrThrow,
  getImportOrThrow,
  normalizeNullableText,
  sortValidLinesForEstimateCreation,
  toRpcImportLines,
} from "@/lib/affaires/import-flow-server";
import { createMapping } from "@/lib/mappings/server";
import { mappingRecordSchema } from "@/lib/mappings/schemas";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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

const confirmUnifiedImportFlowSchema = z.object({
  importId: z.string().uuid("importId invalide."),
  projectId: z.string().uuid("projectId invalide.").nullable().optional(),
  mapping: z.record(z.string(), z.union([z.string(), z.null()])).optional(),
  createEstimate: z.boolean(),
  versionTitle: z.string().trim().max(200).nullable().optional(),
  sectionTitle: z.string().trim().max(200).nullable().optional(),
});
export type ConfirmUnifiedImportFlowInput = z.infer<typeof confirmUnifiedImportFlowSchema>;

async function createVersionFromMappedRows(input: {
  supabase: Supabase;
  importId: string;
  projectId: string;
  versionTitle: string | null;
  sectionTitle: string | null;
  lines: RpcImportLinesPayload[];
}) {
  const { data, error } = await input.supabase.rpc("create_estimate_version_from_import_lines", {
    p_project_id: input.projectId,
    p_import_id: input.importId,
    p_version_title: input.versionTitle,
    p_section_title: input.sectionTitle,
    p_lines: input.lines,
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
    lines: toRpcImportLines(
      sortValidLinesForEstimateCreation(normalizedRows.validLines)
    ),
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
