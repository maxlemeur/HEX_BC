"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  buildImportFlowStats,
  importRequiresPreview,
  normalizeMappedRowsForEstimateCreation,
} from "@/lib/affaires/import-flow";
import {
  DEFAULT_MARGIN_MULTIPLIER,
  DEFAULT_TAX_RATE_BP,
  assertProjectAccessOrThrow,
  fetchLatestMappingId,
  fetchMappedRowsForImport,
  getCurrentMembershipOrThrow,
  getImportOrThrow,
  normalizeNullableText,
  toRpcImportItems,
  type Supabase,
} from "@/lib/affaires/import-flow-server";
import { resolveImportSaleCoefficients, v3LineContext } from "@/lib/affaires/import-engine-server";
import { readTenantCalcPolicy } from "@/lib/estimates/calc-policy-server";
import { persistCanonicalEstimateV2 } from "@/lib/estimates/canonical-v2-creation";
import { EstimateEngineUnavailableError } from "@/lib/estimates/engine/capabilities";
import { ApiError } from "@/lib/estimates/errors";
import { createEstimate } from "@/lib/estimates/server";
import { createMapping } from "@/lib/mappings/server";
import { mappingRecordSchema } from "@/lib/mappings/schemas";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const affaireProjectMetadataSchema = z.object({
  projectName: z.string().trim().min(1, "Nom projet requis.").max(200),
  clientName: z.string().trim().max(200).nullable().optional(),
  reference: z.string().trim().max(200).nullable().optional(),
});

const quickCreateAffaireSchema = affaireProjectMetadataSchema.extend({
  importId: z.string().uuid("importId invalide.").nullable().optional(),
  linkImportId: z.string().uuid("linkImportId invalide.").nullable().optional(),
  mapping: z.record(z.string(), z.union([z.string(), z.null()])).optional(),
  versionTitle: z.string().trim().max(200).nullable().optional(),
  sectionTitle: z.string().trim().max(200).nullable().optional(),
});

export type QuickCreateAffaireInput = z.infer<typeof quickCreateAffaireSchema>;
export type InitializeAffaireDraftInput = z.infer<typeof affaireProjectMetadataSchema>;

export type InitializeAffaireDraftResult = {
  projectId: string;
  versionId: string;
  redirectUrl: string;
  manualEstimate: ManualEstimateEntryPointResult;
};

export type ManualEstimateEntryPointResult = {
  mode: "manual";
  creationMode: "blank";
  projectId: string;
  versionId: string;
  editorRedirectUrl: string;
};

export type StartAffaireFromImportResult =
  | {
      destination: "estimate_editor";
      projectId: string;
      versionId: string;
      redirectUrl: string;
      manualEstimate: ManualEstimateEntryPointResult;
    }
  | {
      destination: "estimate_editor";
      projectId: string;
      versionId: string;
      redirectUrl: string;
    };

function revalidateQuickCreatePaths(projectId: string, versionId: string | null) {
  revalidatePath("/dashboard/affaires");
  revalidatePath(`/dashboard/affaires/${projectId}`);
  revalidatePath("/dashboard/imports");
  revalidatePath("/dashboard/mappings");
  revalidatePath("/dashboard/estimates");

  if (versionId) {
    revalidatePath(`/dashboard/estimates/${versionId}/edit`);
  }
}

function ensureEngineerOrAdmin(role: string) {
  if (role !== "engineer" && role !== "admin") {
    throw new Error("Accès refuse: rôle non autorise pour cette action.");
  }
}

function buildManualEstimateEntryPoint(
  projectId: string,
  versionId: string
): ManualEstimateEntryPointResult {
  return {
    mode: "manual",
    creationMode: "blank",
    projectId,
    versionId,
    editorRedirectUrl: `/dashboard/estimates/${versionId}/edit?entry=manual`,
  };
}

/**
 * Sous-lot 2.10a (N1) : une version vierge a des réglages neutres pour tout moteur ; l'action déclare donc le moteur
 * de la politique qu'elle lit, comme l'import de l'affaire. La création relit la politique sous verrou : une
 * politique changée entre-temps donne CONTEXT_CHANGED sans rien écrire (D3).
 */
async function readExpectedCreationEngine(supabase: Supabase, tenantId: string) {
  return (await readTenantCalcPolicy(supabase, tenantId)).engine;
}

async function createProjectWithBlankEstimate({
  projectName,
  clientName,
  reference,
  linkedImportId,
  expectedEngine,
}: {
  projectName: string;
  clientName: string | null;
  reference: string | null;
  linkedImportId?: string | null;
  expectedEngine: 2 | 3;
}) {
  const created = await createEstimate({
    project: {
      name: projectName,
      client_name: clientName,
      reference,
    },
    creation_mode: "blank",
    version: { expected_calc_engine_version: expectedEngine },
    ...(linkedImportId ? { linked_import_id: linkedImportId } : {}),
  });

  return {
    projectId: created.project.id,
    versionId: created.version.id,
  };
}

async function getQuickCreateContext() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error("Authentification requise.");
  }

  const membership = await getCurrentMembershipOrThrow(supabase, user.id);
  ensureEngineerOrAdmin(membership.role);
  const isTenantAdmin = membership.role === "admin";

  return {
    supabase,
    membership,
    userId: user.id,
    isTenantAdmin,
  };
}

async function createAndOptionallyLinkEmptyAffaire(input: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  membership: Awaited<ReturnType<typeof getQuickCreateContext>>["membership"];
  userId: string;
  isTenantAdmin: boolean;
  projectName: string;
  clientName: string | null;
  reference: string | null;
  linkImportId?: string | null;
}): Promise<InitializeAffaireDraftResult> {
  if (input.linkImportId) {
    const importRow = await getImportOrThrow({
      supabase: input.supabase,
      importId: input.linkImportId,
      tenantId: input.membership.tenant_id,
      userId: input.userId,
      isTenantAdmin: input.isTenantAdmin,
    });

    if (importRow.project_id) {
      throw new Error("Cet import est déjà lié a une autre affaire.");
    }
  }

  const { projectId, versionId } = await createProjectWithBlankEstimate({
    projectName: input.projectName,
    clientName: input.clientName,
    reference: input.reference,
    linkedImportId: input.linkImportId,
    expectedEngine: await readExpectedCreationEngine(input.supabase, input.membership.tenant_id),
  });

  const manualEstimate = buildManualEstimateEntryPoint(projectId, versionId);
  revalidateQuickCreatePaths(projectId, versionId);

  return {
    projectId,
    versionId,
    redirectUrl: manualEstimate.editorRedirectUrl,
    manualEstimate,
  };
}

export async function initializeAffaireDraft(
  input: InitializeAffaireDraftInput & { linkImportId?: string | null }
): Promise<InitializeAffaireDraftResult> {
  const parsed = affaireProjectMetadataSchema
    .extend({
      linkImportId: z.string().uuid("linkImportId invalide.").nullable().optional(),
    })
    .safeParse(input);
  if (!parsed.success) {
    throw new Error("Payload de création affaire invalide.");
  }

  const context = await getQuickCreateContext();

  return createAndOptionallyLinkEmptyAffaire({
    supabase: context.supabase,
    membership: context.membership,
    userId: context.userId,
    isTenantAdmin: context.isTenantAdmin,
    projectName: parsed.data.projectName.trim(),
    clientName: normalizeNullableText(parsed.data.clientName),
    reference: normalizeNullableText(parsed.data.reference),
    linkImportId: parsed.data.linkImportId ?? null,
  });
}

const startAffaireManualEstimateSchema = z.object({
  projectId: z.string().uuid("projectId invalide."),
  versionTitle: z.string().trim().max(200).nullable().optional(),
});

export type StartAffaireManualEstimateInput = z.infer<
  typeof startAffaireManualEstimateSchema
>;

export type StartAffaireManualEstimateResult = ManualEstimateEntryPointResult;

export async function startAffaireManualEstimate(
  input: StartAffaireManualEstimateInput
): Promise<StartAffaireManualEstimateResult> {
  const parsed = startAffaireManualEstimateSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Payload de création manuelle invalide.");
  }

  const context = await getQuickCreateContext();

  await assertProjectAccessOrThrow({
    supabase: context.supabase,
    projectId: parsed.data.projectId,
    tenantId: context.membership.tenant_id,
    userId: context.userId,
    isTenantAdmin: context.isTenantAdmin,
  });

  const versionTitle = normalizeNullableText(parsed.data.versionTitle);
  const created = await createEstimate({
    project_id: parsed.data.projectId,
    creation_mode: "blank",
    // Affaire existante : la profondeur de sections vient de la dernière version, avec ou sans titre (revue de suivi
    // de F4, PR #33). Moteur de la politique lue (2.10a, N1).
    version: {
      ...(versionTitle ? { title: versionTitle } : {}),
      expected_calc_engine_version: await readExpectedCreationEngine(context.supabase, context.membership.tenant_id),
    },
  });

  revalidateQuickCreatePaths(created.project.id, created.version.id);

  return buildManualEstimateEntryPoint(created.project.id, created.version.id);
}

export async function startAffaireFromImport(
  input: QuickCreateAffaireInput
): Promise<StartAffaireFromImportResult> {
  const parsed = quickCreateAffaireSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Payload de création affaire invalide.");
  }

  const { supabase, membership, userId, isTenantAdmin } =
    await getQuickCreateContext();

  const projectName = parsed.data.projectName.trim();
  const clientName = normalizeNullableText(parsed.data.clientName);
  const reference = normalizeNullableText(parsed.data.reference);
  const importId = parsed.data.importId ?? null;
  const linkImportId = importId ? null : (parsed.data.linkImportId ?? null);

  if (!importId) {
    return {
      destination: "estimate_editor",
      ...(await createAndOptionallyLinkEmptyAffaire({
        supabase,
        membership,
        userId,
        isTenantAdmin,
        projectName,
        clientName,
        reference,
        linkImportId,
      })),
    };
  }

  const importRow = await getImportOrThrow({
    supabase,
    importId,
    tenantId: membership.tenant_id,
    userId,
    isTenantAdmin,
  });

  if (importRow.project_id) {
    throw new Error("Cet import est déjà lié a une autre affaire.");
  }

  const normalizedMapping = mappingRecordSchema.parse(parsed.data.mapping ?? {});
  let mappingId: string | null = null;

  if (Object.keys(normalizedMapping).length > 0) {
    const createMappingResult = await createMapping({
      import_id: importId,
      mapping: normalizedMapping,
      save_template: false,
    });
    mappingId = createMappingResult.mapping.id;
  }

  if (!mappingId) {
    mappingId = await fetchLatestMappingId({
      supabase,
      importId,
      tenantId: membership.tenant_id,
    });
  }

  const mappedRows = await fetchMappedRowsForImport({
    supabase,
    importId,
    tenantId: membership.tenant_id,
  });

  // Sous-lot 2.10a (A2) : sous une politique 3, lignes normalisées pour le moteur 3 comme l'import de l'affaire.
  const saleCoefficients = await resolveImportSaleCoefficients({
    supabase,
    tenantId: membership.tenant_id,
    rows: mappedRows,
    requested: undefined,
  });
  const normalizedRows = normalizeMappedRowsForEstimateCreation(mappedRows, {
    marginMultiplier: DEFAULT_MARGIN_MULTIPLIER,
    defaultTaxRateBp: DEFAULT_TAX_RATE_BP,
    entry: "direct",
    ...v3LineContext(saleCoefficients),
  });

  // Hours per unit and workbook parameters need the import preview (P-16, E17): the affaire is
  // created empty with the import linked, as for an unconfident mapping, never priced at 0 €/h.
  if (normalizedRows.validLines.length === 0 || importRequiresPreview(normalizedRows)) {
    return {
      destination: "estimate_editor",
      ...(await createAndOptionallyLinkEmptyAffaire({
        supabase,
        membership,
        userId,
        isTenantAdmin,
        projectName,
        clientName,
        reference,
        linkImportId: importId,
      })),
    };
  }

  let created: Awaited<ReturnType<typeof persistCanonicalEstimateV2>>;
  try {
    created = await persistCanonicalEstimateV2({
      supabase,
      tenantId: membership.tenant_id,
      actorUserId: userId,
      project: {
        kind: "new",
        name: projectName,
        clientName,
        reference,
      },
      version: {
        title: normalizeNullableText(parsed.data.versionTitle) ?? "Import DPGF",
        ...(saleCoefficients
          ? { sale_coefficient_fo: saleCoefficients.fo, sale_coefficient_mo: saleCoefficients.mo }
          : {}),
      },
      source: {
        kind: "import",
        importId,
        mappingId,
        filename: importRow.filename,
        sectionTitle: normalizeNullableText(parsed.data.sectionTitle),
        items: toRpcImportItems(normalizedRows.validItems, {
          importId,
          mappingId,
        }),
        ...(saleCoefficients ? { engine: 3 } : {}),
      },
      expectedCalcEngineVersion: saleCoefficients ? 3 : 2,
    });
  } catch (error) {
    // Sous-lot 2.10a (A2) : un refus nommé garde sa cause au lieu du message générique.
    const named = error instanceof ApiError || error instanceof EstimateEngineUnavailableError;
    throw new Error(
      named ? `Impossible de créer l'affaire depuis l'import : ${error.message}` : "Impossible de créer l'affaire depuis l'import.",
      { cause: error }
    );
  }

  const stats = buildImportFlowStats(
    normalizedRows,
    created.insertedLineCount,
    normalizedRows.validSections.length
  );
  revalidateQuickCreatePaths(created.project.id, created.version.id);

  const redirectParams = new URLSearchParams({
    fromQuickCreate: "1",
    projectId: created.project.id,
    importId,
    insertedRows: String(stats.insertedRows),
    skippedRows: String(stats.skippedRows),
    totalHtCents: String(created.version.total_ht_cents ?? 0),
    totalTaxCents: String(created.version.total_tax_cents ?? 0),
    totalTtcCents: String(created.version.total_ttc_cents ?? 0),
    mappingId: mappingId ?? "",
  });

  return {
    destination: "estimate_editor",
    projectId: created.project.id,
    versionId: created.version.id,
    redirectUrl: `/dashboard/estimates/${created.version.id}/edit?${redirectParams.toString()}`,
  };
}

export async function quickCreateAffaire(input: QuickCreateAffaireInput) {
  const result = await startAffaireFromImport(input);
  redirect(result.redirectUrl);
}
