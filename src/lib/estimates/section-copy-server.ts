import { prepareSectionsImport, selectSectionImportSubtrees } from "@/lib/estimates/section-copy-plan";
import { randomUUID } from "node:crypto";
import { resolveEstimateEngineVersion } from "@/lib/estimates/calc-engine-version";
import { insertCopiedEstimateItems } from "@/lib/estimates/copy-items-server";
import { usesPerUnitLabor } from "@/lib/estimates/engine/capabilities";
import { badRequest, internalError, notFound } from "@/lib/estimates/errors";
import { getNextItemPosition, fetchEstimateVersionToken } from "@/lib/estimates/item-write-context";
import {
  collectSectionSubtreeItems,
  buildImportedSubtreePayload,
} from "@/lib/estimates/section-copy-plan";
import {
  readAllItemsForCopy,
  readSelectedSubtreesForCopy,
} from "@/lib/estimates/section-copy-read-server";
import type { ImportEstimateSectionsResult } from "@/lib/estimates/section-copy-contracts";
import type {
  DuplicateEstimateSectionInput,
  ImportEstimateSectionsInput,
} from "@/lib/estimates/schemas";
import {
  assertDraftLockOwnedByCurrentUser,
  assertDraftStatus,
  getAuthenticatedContext,
  getVersionAccessOrThrow,
} from "@/lib/estimates/server-context";
import {
  commitV3Copy,
  estimateV3SectionCopyToHistoricalError,
  planV3SectionCopy,
} from "@/lib/estimates/v3-section-copy";
import { recalculateEstimateVersionTotals } from "@/lib/estimates/version-recalculation-server";

async function duplicateSectionInternal(input: {
  sectionId: string;
  targetVersionId?: string;
  expectedSourceVersionId?: string;
}) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;

  const { data: sourceSectionData, error: sourceSectionError } = await supabase
    .from("estimate_items")
    .select("id, version_id, item_type, title")
    .eq("tenant_id", tenantId)
    .eq("id", input.sectionId)
    .single();

  if (sourceSectionError || !sourceSectionData) {
    throw notFound("Section introuvable.");
  }

  if (input.expectedSourceVersionId) {
    const belongsToExpectedVersion =
      sourceSectionData.version_id === input.expectedSourceVersionId;
    if (!belongsToExpectedVersion) {
      throw notFound("Section introuvable.");
    }
  }

  if (sourceSectionData.item_type !== "section") {
    throw badRequest("Seules les sections peuvent être dupliquees.");
  }

  const sourceVersionId = sourceSectionData.version_id;
  const { version: sourceVersion } = await getVersionAccessOrThrow(
    supabase,
    sourceVersionId,
    context
  );

  const resolvedTargetVersionId = input.targetVersionId ?? sourceVersion.id;
  const { version: targetVersion } = await getVersionAccessOrThrow(
    supabase,
    resolvedTargetVersionId,
    context
  );
  // Lot 2, sous-lot 2.8b (A6, D-e) : une section entre dans une v3 par l'écrivain de lot (v3-section-copy.ts) ;
  // une section v3 n'entre pas dans une v1/v2, refus nommé avant toute écriture.
  const sourceIsV3 = usesPerUnitLabor(resolveEstimateEngineVersion(sourceVersion));
  const targetIsV3 = usesPerUnitLabor(resolveEstimateEngineVersion(targetVersion));
  if (sourceIsV3 && !targetIsV3) throw estimateV3SectionCopyToHistoricalError();

  assertDraftStatus(targetVersion.status);
  const targetLock = await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId: targetVersion.id,
    userId,
  });

  // The section and its descendants, by pages, pinned to the version read with its access: a partial or mixed read
  // would copy part of the section, or two states of it.
  const sourceItems = await readSelectedSubtreesForCopy(supabase, tenantId, sourceVersion, [input.sectionId]);
  const subtree = collectSectionSubtreeItems(input.sectionId, sourceItems);

  if (!subtree) {
    throw notFound("Section introuvable.");
  }

  const rootPosition = await getNextItemPosition(supabase, targetVersion.id, null);
  const duplicatedRootTitle = `${subtree.rootSection.title} (copie)`;
  const newIdBySourceId = new Map<string, string>();

  subtree.orderedSubtreeItems.forEach((item) => {
    newIdBySourceId.set(item.id, randomUUID());
  });

  const { items: duplicatedItemsPayload } = buildImportedSubtreePayload({
    subtree, tenantId, targetVersionId: targetVersion.id,
    rootPosition, rootTitle: duplicatedRootTitle, newIdBySourceId,
    failureMessage: "Impossible de dupliquer la section.",
  });

  const duplicatedSectionId = newIdBySourceId.get(input.sectionId);
  if (targetIsV3 && duplicatedSectionId) {
    const plan = planV3SectionCopy({
      payload: duplicatedItemsPayload,
      sourceIdByNewId: new Map([...newIdBySourceId].map(([sourceId, newId]) => [newId, sourceId])),
      sourceItemsById: new Map(sourceItems.map((item) => [item.id, item])),
      sourceIsV3,
      sameVersion: sourceVersion.id === targetVersion.id,
    });
    const committed = await commitV3Copy({ versionId: targetVersion.id, updatedAt: targetVersion.updated_at, plan });
    return {
      duplicated_section_id: duplicatedSectionId,
      source_version_id: sourceVersion.id,
      target_version_id: targetVersion.id,
      copied_item_count: duplicatedItemsPayload.length,
      converted_lines: plan.convertedLines,
      totals: committed.totals,
      version: { id: committed.version.id, updated_at: committed.version.updated_at },
    };
  }

  await insertCopiedEstimateItems({
    supabase,
    versionId: targetVersion.id,
    draftLockSessionId: targetLock.session_id,
    items: duplicatedItemsPayload,
    failureMessage: "Impossible de dupliquer la section.",
  });

  if (!duplicatedSectionId) {
    throw internalError("Impossible de dupliquer la section.");
  }

  const recalculateResult = await recalculateEstimateVersionTotals({
    supabase,
    tenantId,
    versionId: targetVersion.id,
  });

  return {
    duplicated_section_id: duplicatedSectionId,
    source_version_id: sourceVersion.id,
    target_version_id: targetVersion.id,
    copied_item_count: duplicatedItemsPayload.length,
    totals: recalculateResult.totals,
    version: recalculateResult.version,
  };
}

export async function duplicateSection(
  sectionId: string,
  targetVersionId?: string
) {
  return duplicateSectionInternal({
    sectionId,
    targetVersionId,
  });
}

export async function duplicateSectionFromVersion(
  sourceVersionId: string,
  sectionId: string,
  input?: DuplicateEstimateSectionInput
) {
  return duplicateSectionInternal({
    sectionId,
    targetVersionId: input?.target_version_id ?? undefined,
    expectedSourceVersionId: sourceVersionId,
  });
}

export async function importSectionsFromVersion(
  targetVersionId: string,
  input: ImportEstimateSectionsInput
): Promise<ImportEstimateSectionsResult> {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;

  const { version: targetVersion } = await getVersionAccessOrThrow(
    supabase,
    targetVersionId,
    context
  );
  // Lot 2, sous-lot 2.8b (A7) : une section d'une autre version entre dans une v3 par l'écrivain de lot, convertie
  // par la règle P-12 depuis une v1/v2 (v3-section-copy.ts).
  const targetIsV3 = usesPerUnitLabor(resolveEstimateEngineVersion(targetVersion));
  assertDraftStatus(targetVersion.status);
  const targetLock = await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId: targetVersion.id,
    userId,
  });

  const { version: sourceVersion } = await getVersionAccessOrThrow(
    supabase,
    input.source_version_id,
    context
  );
  // D-e : une section d'une v3 ne se copie pas vers une v1/v2 (lignes non chiffrées), refus nommé.
  const sourceIsV3 = usesPerUnitLabor(resolveEstimateEngineVersion(sourceVersion));
  if (sourceIsV3 && !targetIsV3) throw estimateV3SectionCopyToHistoricalError();

  // The selected sections of the source with their descendants and every item of the target, by pages, each pinned
  // to the version read with its access. A partial or mixed source read would import part of a section; a target one
  // would reuse its titles and child positions.
  const [sourceItems, targetItems] = await Promise.all([
    readSelectedSubtreesForCopy(supabase, tenantId, sourceVersion, input.section_ids),
    readAllItemsForCopy(supabase, tenantId, targetVersion),
  ]);
  const sourceItemById = new Map(sourceItems.map((item) => [item.id, item]));

  const subtrees = selectSectionImportSubtrees(sourceItems, input.section_ids);
  const newIdsBySubtree = subtrees.map((subtree) => new Map(
    subtree.orderedSubtreeItems.map((item) => [item.id, randomUUID()])
  ));
  const {
    items: importedItemsPayload, sourceIdByNewId, createdSectionIds, createdLineIds,
    importedLinesCount, importedSectionsCount,
  } = prepareSectionsImport({
    subtrees, targetItems, mode: input.mode, tenantId,
    targetVersionId: targetVersion.id, newIdsBySubtree,
  });

  if (importedItemsPayload.length > 0 && targetIsV3) {
    const plan = planV3SectionCopy({
      payload: importedItemsPayload,
      sourceIdByNewId,
      sourceItemsById: sourceItemById,
      sourceIsV3,
      sameVersion: sourceVersion.id === targetVersion.id,
    });
    const committed = await commitV3Copy({ versionId: targetVersion.id, updatedAt: targetVersion.updated_at, plan,
      targetItems });
    return {
      source_version_id: sourceVersion.id,
      target_version_id: targetVersion.id,
      mode: input.mode,
      imported_sections_count: importedSectionsCount,
      imported_lines_count: importedLinesCount,
      created_section_ids: createdSectionIds,
      created_line_ids: createdLineIds,
      converted_lines: plan.convertedLines,
      totals: committed.totals,
      version: { id: committed.version.id, updated_at: committed.version.updated_at },
    };
  }

  if (importedItemsPayload.length > 0) {
    await insertCopiedEstimateItems({
      supabase,
      versionId: targetVersion.id,
      draftLockSessionId: targetLock.session_id,
      items: importedItemsPayload,
      failureMessage: "Impossible d'importer les sections.",
    });
  }

  const recalculateResult =
    importedItemsPayload.length > 0
      ? await recalculateEstimateVersionTotals({
          supabase,
          tenantId,
          versionId: targetVersion.id,
        })
      : {
          totals: {
            total_ht_cents: targetVersion.total_ht_cents ?? 0,
            total_tax_cents: targetVersion.total_tax_cents ?? 0,
            total_ttc_cents: targetVersion.total_ttc_cents ?? 0,
          },
          version: await fetchEstimateVersionToken({
            supabase,
            tenantId,
            versionId: targetVersion.id,
          }),
        };

  return {
    source_version_id: sourceVersion.id,
    target_version_id: targetVersion.id,
    mode: input.mode,
    imported_sections_count: importedSectionsCount,
    imported_lines_count: importedLinesCount,
    created_section_ids: createdSectionIds,
    created_line_ids: createdLineIds,
    totals: recalculateResult.totals,
    version: recalculateResult.version,
  };
}
