"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  buildImportFlowStats,
  normalizeMappedRowsForEstimateCreation,
  resolveImportLaborRole,
  type ImportFlowLineValuesContext,
  type ImportFlowMappedRowInput,
  type ImportLaborRoleCandidate,
  type ImportLaborRoleResolution,
  type ImportWorkbookParameters,
  type InvalidImportFlowLineReason,
  type NormalizeImportFlowRowsOptions,
  type NormalizeImportFlowRowsResult,
} from "@/lib/affaires/import-flow";
import {
  type Supabase,
  DEFAULT_MARGIN_MULTIPLIER,
  DEFAULT_TAX_RATE_BP,
  assertProjectAccessOrThrow,
  ensureImportProjectLink,
  fetchLatestMappingId,
  fetchMappedRowsForImport,
  fetchProjectOwnerLaborRoles,
  fetchVersionComputationContext,
  getCurrentMembershipOrThrow,
  getImportOrThrow,
  normalizeNullableText,
  toRpcImportItems,
} from "@/lib/affaires/import-flow-server";
import {
  resolveImportSaleCoefficients,
  v3LineContext,
  type ImportSaleCoefficients,
} from "@/lib/affaires/import-engine-server";
import { persistCanonicalEstimateV2 } from "@/lib/estimates/canonical-v2-creation";
import { IMPORT_CONTROL_TOLERANCE_CENTS, type ImportUnitPriceCheck } from "@/lib/imports/optima-profile";
import {
  createMapping,
  findPerUnitDurationsMappedToLineHours,
  loadMappedImportRowsForPreview,
} from "@/lib/mappings/server";
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

// Lot 2, sous-lot 2.8 (E4): a v3 sale coefficient, in ]0 ; 10] with four decimals at most (D5).
const saleCoefficientSchema = z
  .number()
  .gt(0)
  .lte(10)
  .refine((value) => Math.abs(value * 10_000 - Math.round(value * 10_000)) < 1e-6, {
    message: "Coefficient de vente : quatre décimales au plus.",
  });
const saleCoefficientsSchema = z.object({ fo: saleCoefficientSchema, mo: saleCoefficientSchema });

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
  // Labour role of the imported hours chosen at the preview (E17). Omitted: the workbook rate
  // decides; null: the explicit « no role » choice (MO valued at 0 €/h, warned in the preview).
  laborRoleId: z.string().uuid("laborRoleId invalide.").nullable().optional(),
  // Sale coefficients of the v3 chosen at the preview (2.8, E4). Omitted: the workbook's, else the policy's.
  saleCoefficients: saleCoefficientsSchema.optional(),
});
export type ConfirmUnifiedImportFlowInput = z.infer<typeof confirmUnifiedImportFlowSchema>;

const previewUnifiedImportFlowLinesSchema = z.object({
  importId: z.string().uuid("importId invalide."),
  projectId: z.string().uuid("projectId invalide."),
  mapping: z.record(z.string(), z.union([z.string(), z.null()])),
  laborRoleId: z.string().uuid("laborRoleId invalide.").nullable().optional(),
  saleCoefficients: saleCoefficientsSchema.optional(),
});
export type PreviewUnifiedImportFlowLinesInput = z.infer<typeof previewUnifiedImportFlowLinesSchema>;

const PREVIEW_LINE_LIMIT = 200;

export type ImportFlowLinesPreview = {
  validLineCount: number;
  ignoredParameterRows: number;
  invalidLines: Array<{ rowIndex: number; reason: InvalidImportFlowLineReason }>;
  invalidLineCount: number;
  hours: {
    linesWithHours: number;
    convertedLines: number;
    totalLineHours: number;
    lines: Array<{
      rowIndex: number;
      title: string;
      quantity: number;
      hoursPerUnit: number | null;
      lineHours: number;
    }>;
  };
  workbookParameters: ImportWorkbookParameters | null;
  versionMarginMultiplier: number;
  laborRoles: ImportLaborRoleCandidate[];
  laborRole: {
    status: ImportLaborRoleResolution["status"];
    roleId: string | null;
    matchingRoleIds: string[];
  };
  unitPriceChecks: {
    checked: number;
    toleranceCents: number;
    outOfTolerance: ImportUnitPriceCheck[];
  };
  // Columns named as a duration per unit but read as the line's total hours (2.3 review, C-01).
  perUnitDurationsAsLineHours: string[];
  // Lot 2, sous-lot 2.8: engine of the estimate the import creates, and the v3 sale coefficients.
  engine: 2 | 3;
  saleCoefficients: ImportSaleCoefficients | null;
};

// Sale coefficients of the v3 an import creates (2.8, E4): resolved by src/lib/affaires/import-engine-server.ts,
// shared since 2.10a with the quick creation from an import and the wizard's linked DPGF source.

function hasImportedLaborHours(normalized: NormalizeImportFlowRowsResult) {
  return normalized.validLines.some((line) => line.hMo > 0);
}

/**
 * Normalizes the mapped rows, resolves the labour role of their hours from the workbook rate or
 * the explicit choice, then normalizes again with that role so PU and totals price the hours.
 */
function normalizeWithLaborRole(input: {
  rows: ImportFlowMappedRowInput[];
  context: Omit<ImportFlowLineValuesContext, "laborRole">;
  options: NormalizeImportFlowRowsOptions;
  roles: ImportLaborRoleCandidate[];
  requestedRoleId: string | null | undefined;
}) {
  const withoutRole = normalizeMappedRowsForEstimateCreation(input.rows, input.context, input.options);
  const resolution = resolveImportLaborRole({
    hasLaborHours: hasImportedLaborHours(withoutRole),
    workbookHourlyRateCents: withoutRole.workbookParameters?.hourlyRateCents ?? null,
    roles: input.roles,
    requestedRoleId: input.requestedRoleId,
  });
  const normalized =
    resolution.status === "resolved"
      ? normalizeMappedRowsForEstimateCreation(
          input.rows,
          {
            ...input.context,
            laborRole: { id: resolution.role.id, hourlyRateCents: resolution.role.hourlyRateCents },
          },
          input.options
        )
      : withoutRole;
  return { normalized, resolution };
}

function formatHourlyRate(cents: number) {
  const euros = (cents / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${euros} €/h`;
}

function assertLaborRoleResolution(
  resolution: ImportLaborRoleResolution,
  workbookParameters: ImportWorkbookParameters | null
) {
  if (resolution.status === "invalid_role") {
    throw new Error("Le rôle de main-d’œuvre choisi n’est pas un rôle actif du propriétaire de l’affaire.");
  }
  if (resolution.status === "choice_required") {
    const rate = workbookParameters?.hourlyRateCents;
    const rateText = typeof rate === "number" ? ` (${formatHourlyRate(rate)})` : "";
    throw new Error(
      `Choisissez le rôle de main-d’œuvre des heures importées : le taux horaire du classeur${rateText} ne désigne pas un rôle actif unique.`
    );
  }
}

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
    throw new Error("projectId est requis pour créer un chiffrage.");
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
    throw new Error("Cet import est déjà lié a une autre affaire.");
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
      "La version source du carry-over takeoff a change. Rechargez la confirmation avant de créer le chiffrage."
    );
  }

  const normalizationOptions = {
    detectStructure: true,
    structureDecisions: parsed.data.structurePlan?.decisions ?? [],
  };
  // Under a policy at engine 3 the created estimate is a v3 (2.8): lines normalized for engine 3.
  const saleCoefficients =
    parsed.data.createEstimate && requestedProjectId
      ? await resolveImportSaleCoefficients({
          supabase,
          tenantId: membership.tenant_id,
          rows: mappedRows,
          requested: parsed.data.saleCoefficients,
        })
      : null;
  // The preview step showed h/u × Q, the workbook parameters and the labour role (P-16).
  const lineContext = {
    marginMultiplier: versionContext.margin_multiplier,
    defaultTaxRateBp: versionContext.tax_rate_bp,
    entry: "preview" as const,
    ...v3LineContext(saleCoefficients),
  };
  let normalizedRows = normalizeMappedRowsForEstimateCreation(mappedRows, lineContext, normalizationOptions);

  // Roles are read only when a choice or the workbook rate needs them; hours without either keep
  // the previous behaviour (no role), which the preview reports as valued at 0 €/h.
  const needsLaborRoles =
    typeof parsed.data.laborRoleId === "string" ||
    typeof normalizedRows.workbookParameters?.hourlyRateCents === "number";
  if (
    parsed.data.createEstimate &&
    effectiveProjectId &&
    needsLaborRoles &&
    hasImportedLaborHours(normalizedRows)
  ) {
    const withLaborRole = normalizeWithLaborRole({
      rows: mappedRows,
      context: lineContext,
      options: normalizationOptions,
      roles: await fetchProjectOwnerLaborRoles({
        supabase,
        projectId: effectiveProjectId,
        tenantId: membership.tenant_id,
      }),
      requestedRoleId: parsed.data.laborRoleId,
    });
    assertLaborRoleResolution(withLaborRole.resolution, withLaborRole.normalized.workbookParameters);
    normalizedRows = withLaborRole.normalized;
  }

  if (parsed.data.createEstimate && normalizedRows.validLines.length === 0) {
    throw new Error("Aucune ligne valide à inserer pour créer le chiffrage.");
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
    throw new Error("projectId est requis pour créer un chiffrage.");
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
        ...(saleCoefficients
          ? { sale_coefficient_fo: saleCoefficients.fo, sale_coefficient_mo: saleCoefficients.mo }
          : {}),
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
        ...(saleCoefficients ? { engine: 3 } : {}),
      },
      ...(saleCoefficients ? { expectedCalcEngineVersion: 3 } : {}),
    });
  } catch (error) {
    throw new Error("Impossible de créer la version depuis l'import.", {
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

/**
 * Import preview before confirmation (P-16, E16-E18): stored line hours computed as h/u × Q,
 * workbook parameters, labour role of the hours, and the self-check against « Prix Unitaire ».
 * Reads dpgf_rows_raw through the mapping in memory; nothing is written.
 */
export async function previewUnifiedImportFlowLines(
  input: PreviewUnifiedImportFlowLinesInput
): Promise<ImportFlowLinesPreview> {
  const parsed = previewUnifiedImportFlowLinesSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Payload d’aperçu invalide.");
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
  const importRow = await getImportOrThrow({
    supabase,
    importId: parsed.data.importId,
    tenantId: membership.tenant_id,
    userId: user.id,
    isTenantAdmin,
  });
  if (importRow.project_id && importRow.project_id !== parsed.data.projectId) {
    throw new Error("Cet import est déjà lié a une autre affaire.");
  }
  await assertProjectAccessOrThrow({
    supabase,
    projectId: parsed.data.projectId,
    tenantId: membership.tenant_id,
    userId: user.id,
    isTenantAdmin,
  });

  const [rows, versionContext, roles] = await Promise.all([
    loadMappedImportRowsForPreview({
      import_id: parsed.data.importId,
      mapping: mappingRecordSchema.parse(parsed.data.mapping),
    }),
    fetchVersionComputationContext(supabase, parsed.data.projectId, membership.tenant_id),
    fetchProjectOwnerLaborRoles({
      supabase,
      projectId: parsed.data.projectId,
      tenantId: membership.tenant_id,
    }),
  ]);
  const saleCoefficients = await resolveImportSaleCoefficients({
    supabase,
    tenantId: membership.tenant_id,
    rows,
    requested: parsed.data.saleCoefficients,
  });
  const { normalized, resolution } = normalizeWithLaborRole({
    rows,
    context: {
      marginMultiplier: versionContext.margin_multiplier,
      defaultTaxRateBp: versionContext.tax_rate_bp,
      entry: "preview",
      ...v3LineContext(saleCoefficients),
    },
    options: { detectStructure: true },
    roles,
    requestedRoleId: parsed.data.laborRoleId,
  });

  const linesWithHours = normalized.validLines.filter(
    (line) => line.hMo > 0 || typeof line.hoursPerUnit === "number"
  );
  const totalLineHourUnits = linesWithHours.reduce((sum, line) => sum + Math.round(line.hMo * 1000), 0);

  return {
    validLineCount: normalized.validLines.length,
    ignoredParameterRows: normalized.ignoredRows.filter((row) => row.reason === "parameters").length,
    invalidLines: normalized.invalidLines
      .slice(0, PREVIEW_LINE_LIMIT)
      .map((line) => ({ rowIndex: line.rowIndex, reason: line.reason })),
    invalidLineCount: normalized.invalidLines.length,
    hours: {
      linesWithHours: linesWithHours.filter((line) => line.hMo > 0).length,
      convertedLines: linesWithHours.filter((line) => typeof line.hoursPerUnit === "number").length,
      totalLineHours: totalLineHourUnits / 1000,
      lines: linesWithHours.slice(0, PREVIEW_LINE_LIMIT).map((line) => ({
        rowIndex: line.rowIndex,
        title: line.title,
        quantity: line.quantity,
        hoursPerUnit: line.hoursPerUnit ?? null,
        lineHours: line.hMo,
      })),
    },
    workbookParameters: normalized.workbookParameters,
    versionMarginMultiplier: versionContext.margin_multiplier,
    laborRoles: roles,
    laborRole: {
      status: resolution.status,
      roleId: resolution.role?.id ?? null,
      matchingRoleIds: resolution.status === "choice_required" ? resolution.matchingRoleIds : [],
    },
    unitPriceChecks: {
      checked: normalized.unitPriceChecks.length,
      toleranceCents: IMPORT_CONTROL_TOLERANCE_CENTS,
      outOfTolerance: normalized.unitPriceChecks
        .filter((check) => Math.abs(check.deltaCents) > IMPORT_CONTROL_TOLERANCE_CENTS)
        .slice(0, PREVIEW_LINE_LIMIT),
    },
    perUnitDurationsAsLineHours: findPerUnitDurationsMappedToLineHours(parsed.data.mapping),
    engine: saleCoefficients ? 3 : 2,
    saleCoefficients,
  };
}
