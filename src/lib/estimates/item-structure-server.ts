import {
  collectEstimateSubtreeIds,
  assertEstimateReorderPermutation,
  assertEstimateMovePermutation,
} from "@/lib/estimates/item-structure-plan";
import {
  DEFAULT_MAX_SECTION_DEPTH,
  clampMaxSectionDepth,
  buildHierarchyIndex,
  isAncestorOrSelf,
  resolveSectionLevel,
} from "@/lib/estimates/hierarchy";
import { badRequest, conflict, mapSupabaseError, notFound } from "@/lib/estimates/errors";
import {
  assertDraftLockOwnedByCurrentUser,
  assertDraftStatus,
  getAuthenticatedContext,
  getVersionAccessOrThrow,
} from "@/lib/estimates/server-context";
import { assertVersionConcurrencyToken } from "@/lib/estimates/version-concurrency";
import { fetchEstimateVersionToken } from "@/lib/estimates/item-write-context";
import {
  assertLinePlacementAllowed,
  assertSectionPlacementAllowed,
  assertSectionSubtreePlacementAllowed,
  ensureParentIsValid,
  loadHierarchyItems,
} from "@/lib/estimates/estimate-placement-helpers";

import { readAllRows } from "@/lib/supabase/read-all";
import { resolveEstimateEngineVersion } from "@/lib/estimates/calc-engine-version";
import { EstimateEngineUnavailableError, usesPerUnitLabor } from "@/lib/estimates/engine/capabilities";
import type {
  DeleteEstimateItemInput,
  ReorderEstimateItemsInput,
  MoveEstimateItemInput,
} from "@/lib/estimates/schemas";

export async function deleteEstimateItem(
  versionId: string,
  input: DeleteEstimateItemInput,
  concurrencyToken?: string
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version } = await getVersionAccessOrThrow(supabase, versionId, context);
  // Lot 2, sous-lot 2.5 (revue, V3P-15) : cette suppression directe ne recalcule rien. Une v3 porte ses
  // montants stockés sous D12 : elle supprime par le lot (`op: "delete"`), qui recalcule et vérifie.
  if (usesPerUnitLabor(resolveEstimateEngineVersion(version))) throw new EstimateEngineUnavailableError();

  assertDraftStatus(version.status);
  if (concurrencyToken !== undefined) {
    assertVersionConcurrencyToken(version.updated_at, concurrencyToken);
  }
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId,
    userId,
  });

  const versionItems: { id: string; parent_id: string | null }[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("estimate_items")
      .select("id, parent_id")
      .eq("tenant_id", tenantId)
      .eq("version_id", versionId)
      .order("id")
      .range(offset, offset + pageSize - 1);
    if (error) throw mapSupabaseError(error, "Impossible de charger les éléments à supprimer.");
    versionItems.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  const deletedIds = collectEstimateSubtreeIds(input.id, versionItems);

  const { error } = await supabase
    .from("estimate_items")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", input.id)
    .eq("version_id", versionId);

  if (error) {
    throw mapSupabaseError(error, "Impossible de supprimer l'élément.");
  }

  return {
    deleted_id: input.id,
    deleted_ids: deletedIds,
    version: await fetchEstimateVersionToken({ supabase, tenantId, versionId }),
  };
}

export async function reorderEstimateItems(
  versionId: string,
  input: ReorderEstimateItemsInput,
  concurrencyToken?: string
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version } = await getVersionAccessOrThrow(supabase, versionId, context);

  assertDraftStatus(version.status);
  if (concurrencyToken !== undefined) {
    assertVersionConcurrencyToken(version.updated_at, concurrencyToken);
  }
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId,
    userId,
  });

  const parentId = input.parent_id ?? null;

  await ensureParentIsValid({
    supabase,
    tenantId,
    versionId,
    parentId,
  });

  let siblingsQuery = supabase
    .from("estimate_items")
    .select("id", { count: "exact" })
    .eq("tenant_id", tenantId)
    .eq("version_id", versionId);

  siblingsQuery = parentId === null
    ? siblingsQuery.is("parent_id", null)
    : siblingsQuery.eq("parent_id", parentId);

  const { data: siblings, error: siblingsError } = await readAllRows(() => siblingsQuery);

  if (siblingsError) {
    throw mapSupabaseError(siblingsError, "Impossible de charger les lignes à reordonner.");
  }

  const siblingIds = (siblings ?? []).map((item) => item.id);

  assertEstimateReorderPermutation(siblingIds, input.ordered_ids);

  const { data: updatedCount, error: reorderError } = await supabase.rpc(
    "reorder_estimate_items",
    {
      target_version_id: versionId,
      target_parent_id: parentId,
      ordered_item_ids: input.ordered_ids,
    }
  );

  if (reorderError) {
    throw mapSupabaseError(reorderError, "Impossible de reordonner les lignes.");
  }

  const normalizedUpdatedCount = updatedCount ?? 0;

  if (normalizedUpdatedCount !== input.ordered_ids.length) {
    throw conflict("La liste de réordonnancement est obsolète.", {
      expected_ids: siblingIds,
      received_ids: input.ordered_ids,
      updated_count: normalizedUpdatedCount,
    });
  }

  return {
    parent_id: parentId,
    ordered_ids: input.ordered_ids,
    updated_count: normalizedUpdatedCount,
    version: await fetchEstimateVersionToken({ supabase, tenantId, versionId }),
  };
}

export async function moveEstimateItem(
  versionId: string,
  input: MoveEstimateItemInput,
  concurrencyToken?: string
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version } = await getVersionAccessOrThrow(supabase, versionId, context);

  assertDraftStatus(version.status);
  if (concurrencyToken !== undefined) {
    assertVersionConcurrencyToken(version.updated_at, concurrencyToken);
  }
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId,
    userId,
  });

  const fromParentId = input.from_parent_id ?? null;
  const toParentId = input.to_parent_id ?? null;

  if (fromParentId === toParentId) {
    throw badRequest(
      "from_parent_id et to_parent_id doivent être différents pour un move inter-parent."
    );
  }

  const { data: item, error: itemError } = await supabase
    .from("estimate_items")
    .select("id, version_id, parent_id, item_type")
    .eq("tenant_id", tenantId)
    .eq("id", input.item_id)
    .eq("version_id", versionId)
    .single();

  if (itemError || !item) {
    throw notFound("Élément de chiffrage introuvable.");
  }

  if ((item.parent_id ?? null) !== fromParentId) {
    throw conflict("Le parent source est obsolete.", {
      item_id: item.id,
      expected_from_parent_id: item.parent_id ?? null,
      received_from_parent_id: fromParentId,
    });
  }

  const targetParent = await ensureParentIsValid({
    supabase,
    tenantId,
    versionId,
    parentId: toParentId,
    itemId: item.id,
  });
  const maxSectionDepth = clampMaxSectionDepth(
    version.max_section_depth,
    DEFAULT_MAX_SECTION_DEPTH
  );
  const hierarchyItems = await loadHierarchyItems({
    supabase,
    tenantId,
    versionId,
  });
  const hierarchyIndex = buildHierarchyIndex(hierarchyItems);
  const targetParentSectionLevel =
    targetParent === null ? null : resolveSectionLevel(hierarchyIndex, targetParent.id);

  if (item.item_type === "section") {
    if (isAncestorOrSelf(hierarchyIndex, item.id, toParentId)) {
      throw badRequest(
        "Une section ne peut pas être déplacée dans sa propre descendance."
      );
    }

    const nextSectionLevel =
      targetParentSectionLevel === null ? 1 : targetParentSectionLevel + 1;
    assertSectionPlacementAllowed({
      maxSectionDepth,
      nextSectionLevel,
    });
    assertSectionSubtreePlacementAllowed({
      hierarchyIndex,
      sectionId: item.id,
      nextSectionLevel,
      maxSectionDepth,
    });
  } else {
    assertLinePlacementAllowed({
      maxSectionDepth,
      parentSectionLevel: targetParentSectionLevel,
    });
  }

  const loadSiblingIds = async (parentId: string | null) => {
    let query = supabase
      .from("estimate_items")
      .select("id", { count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("version_id", versionId)
      .order("position", { ascending: true })
      .order("id", { ascending: true });

    query = parentId === null
      ? query.is("parent_id", null)
      : query.eq("parent_id", parentId);

    const { data: siblings, error: siblingsError } = await readAllRows(() => query);

    if (siblingsError) {
      throw mapSupabaseError(
        siblingsError,
        "Impossible de charger les éléments à déplacer."
      );
    }

    return (siblings ?? []).map((sibling) => sibling.id);
  };

  const sourceSiblings = await loadSiblingIds(fromParentId);

  if (!sourceSiblings.includes(item.id)) {
    throw conflict("La liste de déplacement est obsolète.", {
      reason: "item_not_in_source_parent",
      item_id: item.id,
      from_parent_id: fromParentId,
      observed_source_ids: sourceSiblings,
    });
  }

  const expectedSourceIds = sourceSiblings.filter((siblingId) => siblingId !== item.id);
  const expectedTargetIds = [...(await loadSiblingIds(toParentId)), item.id];

  assertEstimateMovePermutation({
    itemId: item.id, fromParentId, toParentId, expectedSourceIds, expectedTargetIds,
    orderedSourceIds: input.ordered_source_ids, orderedTargetIds: input.ordered_target_ids,
  });

  const { data: updatedCount, error: moveError } = await supabase.rpc(
    "move_estimate_item",
    {
      target_version_id: versionId,
      target_item_id: item.id,
      source_parent_id: fromParentId,
      target_parent_id: toParentId,
      ordered_source_item_ids: input.ordered_source_ids,
      ordered_target_item_ids: input.ordered_target_ids,
    }
  );

  if (moveError) {
    throw mapSupabaseError(moveError, "Impossible de déplacer l'élément.");
  }

  const normalizedUpdatedCount = updatedCount ?? 0;
  const expectedUpdatedCount =
    input.ordered_source_ids.length + input.ordered_target_ids.length;

  if (normalizedUpdatedCount !== expectedUpdatedCount) {
    throw conflict("La liste de déplacement est obsolète.", {
      item_id: item.id,
      from_parent_id: fromParentId,
      to_parent_id: toParentId,
      expected_source_ids: expectedSourceIds,
      received_source_ids: input.ordered_source_ids,
      expected_target_ids: expectedTargetIds,
      received_target_ids: input.ordered_target_ids,
      updated_count: normalizedUpdatedCount,
    });
  }

  return {
    item_id: item.id,
    from_parent_id: fromParentId,
    to_parent_id: toParentId,
    ordered_source_ids: input.ordered_source_ids,
    ordered_target_ids: input.ordered_target_ids,
    updated_count: normalizedUpdatedCount,
    version: await fetchEstimateVersionToken({ supabase, tenantId, versionId }),
  };
}
