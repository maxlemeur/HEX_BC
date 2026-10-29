import { prepareLinkedDpgfLines, prepareLinkedDpgfImportItems } from "@/lib/estimates/linked-dpgf-plan";
import { randomUUID } from "node:crypto";

import type { EstimateItemRecord } from "@/lib/estimate-calculations";
import { resolveEstimateEngineVersion } from "@/lib/estimates/calc-engine-version";
import { DEFAULT_TAX_RATE_BP } from "@/lib/estimates/constants";
import { insertCopiedEstimateItems } from "@/lib/estimates/copy-items-server";
import { usesPerUnitLabor } from "@/lib/estimates/engine/capabilities";
import { badRequest, mapSupabaseError } from "@/lib/estimates/errors";
import { getNextItemPosition } from "@/lib/estimates/item-write-context";
import type { Supabase, EstimateItemInsert } from "@/lib/estimates/item-write-types";
import type { ImportLinkedDpgfSourceResult } from "@/lib/estimates/linked-dpgf-contracts";
import {
  loadLatestLinkedDpgfImportForProject,
  loadMappedRowsForImportWithRetry,
} from "@/lib/estimates/linked-dpgf-read-server";
import {
  normalizeSectionTitleKey,
  resolveImportedSectionTitle,
} from "@/lib/estimates/section-copy-plan";
import type { ImportLinkedDpgfSourceInput } from "@/lib/estimates/schemas";
import {
  assertDraftLockOwnedByCurrentUser,
  assertDraftStatus,
  getAuthenticatedContext,
  getVersionAccessOrThrow,
  toNullableText,
} from "@/lib/estimates/server-context";
import { commitV3Copy, planV3LinkedDpgfImport } from "@/lib/estimates/v3-section-copy";
import { recalculateEstimateVersionTotals } from "@/lib/estimates/version-recalculation-server";
const DEFAULT_MARGIN_MULTIPLIER = 1;

type PreparedLinkedDpgfSource = {
  sourceImportId: string;
  items: EstimateItemInsert[];
  lineItems: Array<EstimateItemInsert & EstimateItemRecord>;
};

async function resolveLinkedDpgfImportSectionTitle(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
  requestedTitle: string | null;
}) {
  const { data, error } = await input.supabase
    .from("estimate_items")
    .select("title")
    .eq("tenant_id", input.tenantId)
    .eq("version_id", input.versionId)
    .eq("item_type", "section")
    .is("parent_id", null);

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de vérifier les chapitres existants."
    );
  }

  const usedRootTitleKeys = new Set<string>();
  for (const row of (data ?? []) as Array<{ title: string }>) {
    usedRootTitleKeys.add(normalizeSectionTitleKey(row.title));
  }

  return resolveImportedSectionTitle({
    sourceTitle: input.requestedTitle ?? "Import DPGF",
    usedTitleKeys: usedRootTitleKeys,
  });
}

type ImportLinkedDpgfSourceInternalInput = {
  supabase: Supabase;
  tenantId: string;
  projectId: string;
  versionId: string;
  marginMultiplier: number;
  defaultTaxRateBp: number;
  sectionTitle?: string | null;
  persist?: boolean;
  /** Sous-lot 2.8b (A5) : brouillon v3, ses coefficients de vente et son jeton ; lignes écrites par l'écrivain de lot. */
  v3?: { saleCoefficientFo: number; saleCoefficientMo: number; updatedAt: string };
  draftLockSessionId?: string | null;
};

async function importLinkedDpgfSourceIntoVersionInternal(
  input: ImportLinkedDpgfSourceInternalInput & { persist: false }
): Promise<PreparedLinkedDpgfSource>;
async function importLinkedDpgfSourceIntoVersionInternal(
  input: ImportLinkedDpgfSourceInternalInput
): Promise<ImportLinkedDpgfSourceResult>;
async function importLinkedDpgfSourceIntoVersionInternal(
  input: ImportLinkedDpgfSourceInternalInput
): Promise<ImportLinkedDpgfSourceResult | PreparedLinkedDpgfSource> {
  const latestImport = await loadLatestLinkedDpgfImportForProject({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
  });

  if (!latestImport) {
    throw badRequest("Aucune source DPGF liée à cette affaire.");
  }

  const mappedRows = await loadMappedRowsForImportWithRetry({
    supabase: input.supabase,
    tenantId: input.tenantId,
    importId: latestImport.id,
    maxAttempts: 10,
    retryDelayMs: 300,
  });

  const { validLines, totalRows } = prepareLinkedDpgfLines({
    mappedRows,
    marginMultiplier: input.marginMultiplier,
    defaultTaxRateBp: input.defaultTaxRateBp,
    v3: input.v3,
  });

  const defaultTitle = toNullableText(latestImport.filename)
    ? `Import DPGF - ${latestImport.filename}`
    : "Import DPGF";
  const resolvedSectionTitle = await resolveLinkedDpgfImportSectionTitle({
    supabase: input.supabase,
    tenantId: input.tenantId,
    versionId: input.versionId,
    requestedTitle: toNullableText(input.sectionTitle) ?? defaultTitle,
  });
  const createdSectionId = randomUUID();
  const rootPosition = await getNextItemPosition(input.supabase, input.versionId, null);

  const { sectionItemPayload, lineItemsPayload } = prepareLinkedDpgfImportItems({
    tenantId: input.tenantId,
    versionId: input.versionId,
    createdSectionId,
    rootPosition,
    resolvedSectionTitle,
    filename: latestImport.filename,
    validLines,
    lineIds: validLines.map(() => randomUUID()),
  });

  if (input.persist === false) {
    return {
      sourceImportId: latestImport.id,
      items: [sectionItemPayload, ...lineItemsPayload],
      lineItems: lineItemsPayload,
    };
  }

  if (input.v3) {
    const committed = await commitV3Copy({
      versionId: input.versionId,
      updatedAt: input.v3.updatedAt,
      plan: planV3LinkedDpgfImport({
        sectionId: createdSectionId,
        rootPosition,
        sectionTitle: resolvedSectionTitle,
        filename: latestImport.filename,
        importId: latestImport.id,
        lines: validLines.map((line, index) => ({ ...line, id: lineItemsPayload[index]!.id as string })),
      }),
    });
    return {
      source_import_id: latestImport.id,
      target_version_id: input.versionId,
      created_section_id: createdSectionId,
      created_line_ids: lineItemsPayload.map((item) => item.id as string),
      imported_lines_count: lineItemsPayload.length,
      skipped_lines_count: Math.max(totalRows - lineItemsPayload.length, 0),
      totals: committed.totals,
      version: { id: committed.version.id, updated_at: committed.version.updated_at },
    };
  }

  await insertCopiedEstimateItems({
    supabase: input.supabase,
    versionId: input.versionId,
    draftLockSessionId: input.draftLockSessionId,
    items: [sectionItemPayload, ...lineItemsPayload],
    failureMessage: "Impossible d'importer la source DPGF liée.",
  });

  const recalculateResult = await recalculateEstimateVersionTotals({
    supabase: input.supabase,
    tenantId: input.tenantId,
    versionId: input.versionId,
  });

  return {
    source_import_id: latestImport.id,
    target_version_id: input.versionId,
    created_section_id: createdSectionId,
    created_line_ids: lineItemsPayload.map((item) => item.id as string),
    imported_lines_count: lineItemsPayload.length,
    skipped_lines_count: Math.max(
      totalRows - lineItemsPayload.length,
      0
    ),
    totals: recalculateResult.totals,
    version: recalculateResult.version,
  };
}

export async function importLinkedDpgfSourceIntoVersion(
  versionId: string,
  input: ImportLinkedDpgfSourceInput
): Promise<ImportLinkedDpgfSourceResult> {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;

  const { version } = await getVersionAccessOrThrow(supabase, versionId, context);
  assertDraftStatus(version.status);
  const lock = await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId,
    userId,
  });

  const marginMultiplier =
    typeof version.margin_multiplier === "number"
      ? version.margin_multiplier
      : DEFAULT_MARGIN_MULTIPLIER;
  const taxRateBp =
    typeof version.tax_rate_bp === "number"
      ? version.tax_rate_bp
      : DEFAULT_TAX_RATE_BP;

  return importLinkedDpgfSourceIntoVersionInternal({
    supabase,
    tenantId,
    projectId: version.project_id,
    versionId,
    marginMultiplier,
    defaultTaxRateBp: taxRateBp,
    sectionTitle: input.section_title ?? null,
    // Sous-lot 2.8b (A5) : normalisé pour le moteur 3 aux coefficients du brouillon, jamais à ceux du classeur.
    ...(usesPerUnitLabor(resolveEstimateEngineVersion(version))
      ? { v3: { saleCoefficientFo: Number(version.sale_coefficient_fo), saleCoefficientMo: Number(version.sale_coefficient_mo),
          updatedAt: version.updated_at } }
      : {}),
    draftLockSessionId: lock.session_id,
  });
}
