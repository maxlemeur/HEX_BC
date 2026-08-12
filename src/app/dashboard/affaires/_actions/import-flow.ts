"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  buildImportFlowStats,
  normalizeMappedRowsForEstimateCreation,
} from "@/lib/affaires/import-flow";
import {
  type Supabase,
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
  toRpcImportItems,
} from "@/lib/affaires/import-flow-server";
import { persistCanonicalEstimateV2 } from "@/lib/estimates/canonical-v2-creation";
import { createMapping } from "@/lib/mappings/server";
import { mappingRecordSchema } from "@/lib/mappings/schemas";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  TakeoffCarryOverStatus,
  TakeoffCarryOverSummary,
} from "@/lib/takeoff/types";
import {
  createTakeoffCarryOverStatus,
  createTakeoffCarryOverSummary,
  linkTakeoffJobsFromSourceVersionToTargetVersion,
  summarizeTakeoffCarryOverSourceVersion,
} from "@/lib/takeoff/version-links";

export type ConfirmUnifiedImportFlowMode = "mapping_only" | "version_created";

export type ImportFlowCreationTotals = {
  totalHtCents: number;
  totalTaxCents: number;
  totalTtcCents: number;
};

export type ConfirmUnifiedImportFlowResult = {
  mode: ConfirmUnifiedImportFlowMode;
  importId: string;
  projectId: string | null;
  mappingId: string | null;
  versionId: string | null;
  redirectTo: string | null;
  takeoffCarryOver: TakeoffCarryOverStatus | null;
  totals: ImportFlowCreationTotals | null;
  stats: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    insertedRows: number;
    skippedRows: number;
    insertedSections: number;
    zeroPriceRows: number;
    ignoredRows: number;
    ignoredFooterRows: number;
  };
};

const structureDecisionSchema = z.union([
  z.object({
    rowIndex: z.number().int().nonnegative(),
    kind: z.literal("section"),
    level: z.union([z.literal(1), z.literal(2)]),
  }),
  z.object({
    rowIndex: z.number().int().nonnegative(),
    kind: z.enum(["line", "ignore"]),
    level: z.null(),
  }),
]);

const confirmUnifiedImportFlowSchema = z.object({
  importId: z.string().uuid("importId invalide."),
  projectId: z.string().uuid("projectId invalide.").nullable().optional(),
  mapping: z.record(z.string(), z.union([z.string(), z.null()])).optional(),
  createEstimate: z.boolean(),
  previewSourceVersionId: z
    .string()
    .uuid("previewSourceVersionId invalide.")
    .nullable()
    .optional(),
  versionTitle: z.string().trim().max(200).nullable().optional(),
  sectionTitle: z.string().trim().max(200).nullable().optional(),
  structurePlan: z.object({ decisions: z.array(structureDecisionSchema).max(10_000) }).optional(),
});
export type ConfirmUnifiedImportFlowInput = z.infer<typeof confirmUnifiedImportFlowSchema>;

const getUnifiedImportFlowTakeoffCarryOverPreviewSchema = z.object({
  projectId: z.string().uuid("projectId invalide."),
});

export type GetUnifiedImportFlowTakeoffCarryOverPreviewInput = z.infer<
  typeof getUnifiedImportFlowTakeoffCarryOverPreviewSchema
>;

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

async function loadTakeoffCarryOverSummary(input: {
  supabase: Supabase;
  tenantId: string;
  sourceVersionId: string | null;
}): Promise<TakeoffCarryOverSummary> {
  try {
    return await summarizeTakeoffCarryOverSourceVersion({
      supabase: input.supabase,
      tenantId: input.tenantId,
      sourceVersionId: input.sourceVersionId,
    });
  } catch (error) {
    console.warn("takeoff carry-over summary unavailable for import flow", {
      sourceVersionId: input.sourceVersionId,
      error,
    });

    return createTakeoffCarryOverSummary({
      sourceVersionId: input.sourceVersionId,
      state: "unavailable",
    });
  }
}

export async function getUnifiedImportFlowTakeoffCarryOverPreview(
  input: GetUnifiedImportFlowTakeoffCarryOverPreviewInput
): Promise<TakeoffCarryOverSummary> {
  const parsed = getUnifiedImportFlowTakeoffCarryOverPreviewSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Payload de preview carry-over invalide.");
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

  await assertProjectAccessOrThrow({
    supabase,
    projectId: parsed.data.projectId,
    tenantId: membership.tenant_id,
    userId: user.id,
    isTenantAdmin,
  });

  const versionContext = await fetchVersionComputationContext(
    supabase,
    parsed.data.projectId,
    membership.tenant_id
  );

  return loadTakeoffCarryOverSummary({
    supabase,
    tenantId: membership.tenant_id,
    sourceVersionId: versionContext.version_id,
  });
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

    if (!parsed.data.createEstimate && !importRow.project_id) {
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
        version_id: null,
        margin_multiplier: DEFAULT_MARGIN_MULTIPLIER,
        tax_rate_bp: DEFAULT_TAX_RATE_BP,
      };

  if (
    parsed.data.createEstimate &&
    parsed.data.previewSourceVersionId !== undefined &&
    parsed.data.previewSourceVersionId !== versionContext.version_id
  ) {
    throw new Error(
      "La version source du carry-over takeoff a change. Rechargez la confirmation avant de creer le chiffrage."
    );
  }

  const normalizedRows = normalizeMappedRowsForEstimateCreation(
    mappedRows,
    {
      marginMultiplier: versionContext.margin_multiplier,
      defaultTaxRateBp: versionContext.tax_rate_bp,
    },
    {
      detectStructure: true,
      structureDecisions: parsed.data.structurePlan?.decisions ?? [],
    }
  );

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
      takeoffCarryOver: null,
      totals: null,
      stats,
    };
  }

  const projectId = requestedProjectId;
  if (!projectId) {
    throw new Error("projectId est requis pour creer un chiffrage.");
  }

  const takeoffCarryOverSummary = await loadTakeoffCarryOverSummary({
    supabase,
    tenantId: membership.tenant_id,
    sourceVersionId: versionContext.version_id,
  });

  let createdVersion: Awaited<ReturnType<typeof persistCanonicalEstimateV2>>;
  try {
    createdVersion = await persistCanonicalEstimateV2({
      supabase,
      tenantId: membership.tenant_id,
      actorUserId: user.id,
      project: {
        kind: "existing",
        id: projectId,
      },
      version: {
        title: normalizeNullableText(parsed.data.versionTitle) ?? "Import DPGF",
      },
      source: {
        kind: "import",
        importId: parsed.data.importId,
        mappingId,
        filename: importRow.filename,
        sectionTitle: normalizeNullableText(parsed.data.sectionTitle),
        items: toRpcImportItems(normalizedRows.validItems, {
          importId: parsed.data.importId,
          mappingId,
        }),
      },
    });
  } catch (error) {
    throw new Error("Impossible de creer la version depuis l'import.", {
      cause: error,
    });
  }

  let takeoffCarryOver: TakeoffCarryOverStatus | null =
    versionContext.version_id !== null
      ? createTakeoffCarryOverStatus({
          summary: takeoffCarryOverSummary,
          linkState: "not_requested",
        })
      : null;

  if (versionContext.version_id) {
    try {
      const carryOverResult = await linkTakeoffJobsFromSourceVersionToTargetVersion({
        supabase,
        tenantId: membership.tenant_id,
        userId: user.id,
        sourceVersionId: versionContext.version_id,
        targetVersionId: createdVersion.version.id,
      });

      takeoffCarryOver = createTakeoffCarryOverStatus({
        summary: takeoffCarryOverSummary,
        linkState:
          carryOverResult.linked_count === carryOverResult.source_job_count
            ? "linked"
            : "partial",
        linkedJobs: carryOverResult.linked_count,
        sourceJobs: carryOverResult.source_job_count,
      });
    } catch (error) {
      console.warn("takeoff carry-over skipped for import flow", {
        sourceVersionId: versionContext.version_id,
        targetVersionId: createdVersion.version.id,
        error,
      });

      takeoffCarryOver = createTakeoffCarryOverStatus({
        summary: takeoffCarryOverSummary,
        linkState: "failed",
      });
    }
  }

  const stats = buildImportFlowStats(
    normalizedRows,
    createdVersion.insertedLineCount,
    normalizedRows.validSections.length
  );
  const redirectTo = `/dashboard/estimates/${createdVersion.version.id}/edit`;

  revalidateImportFlowPaths(projectId, createdVersion.version.id);

  return {
    mode: "version_created",
    importId: parsed.data.importId,
    projectId,
    mappingId,
    versionId: createdVersion.version.id,
    redirectTo,
    takeoffCarryOver,
    totals: {
      totalHtCents: createdVersion.version.total_ht_cents,
      totalTaxCents: createdVersion.version.total_tax_cents,
      totalTtcCents: createdVersion.version.total_ttc_cents,
    },
    stats,
  };
}
