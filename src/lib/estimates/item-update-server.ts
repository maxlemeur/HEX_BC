import {
  prepareEstimateSectionUpdate,
  prepareEstimateLineUpdate,
  calculateEstimateLineUpdate,
} from "@/lib/estimates/item-update-plan";
import {
  DEFAULT_MAX_SECTION_DEPTH,
  clampMaxSectionDepth,
  buildHierarchyIndex,
  isAncestorOrSelf,
} from "@/lib/estimates/hierarchy";
import { badRequest, conflict, mapSupabaseError, notFound } from "@/lib/estimates/errors";
import {
  assertDraftLockOwnedByCurrentUser,
  assertDraftStatus,
  getAuthenticatedContext,
  getVersionAccessOrThrow,
} from "@/lib/estimates/server-context";
import { assertVersionConcurrencyToken } from "@/lib/estimates/version-concurrency";
import {
  fetchEstimateVersionToken,
  resolveEstimateItemAidRegex,
  ensureSupplyTypeIsValid,
  ensureSupplierPriceIsValid,
  ensureProductIsValid,
  resolveLaborRateCents,
} from "@/lib/estimates/item-write-context";
import {
  assertLinePlacementAllowed,
  assertSectionPlacementAllowed,
  assertSectionSubtreePlacementAllowed,
  ensureParentIsValid,
  loadHierarchyItems,
  resolveSectionLevelFromParent,
} from "@/lib/estimates/estimate-placement-helpers";
import { ensureCategoryIsValid } from "@/lib/estimates/estimate-reference-helpers";

import {
  resolveCalcEngineVersion,
  resolveEstimateEngineVersion,
} from "@/lib/estimates/calc-engine-version";
import { isUnifiedEngine, usesPerUnitLabor } from "@/lib/estimates/engine/capabilities";

import { persistTieredDraftLineUpdate } from "@/lib/estimates/item-draft-projection";

import { type UpdateEstimateItemInput } from "@/lib/estimates/schemas";
import { ESTIMATE_V3_ITEM_CONVERSION_REASON } from "@/lib/estimates/v3-editor";

export async function updateEstimateItem(
  versionId: string,
  input: UpdateEstimateItemInput,
  concurrencyToken?: string
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version, project } = await getVersionAccessOrThrow(
    supabase,
    versionId,
    context
  );

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

  const { data: currentItem, error: currentItemError } = await supabase
    .from("estimate_items")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", input.id)
    .eq("version_id", versionId)
    .single();

  if (currentItemError || !currentItem) {
    throw notFound("Élément de chiffrage introuvable.");
  }

  const nextParentId =
    "parent_id" in input ? (input.parent_id ?? null) : currentItem.parent_id;

  const nextParent = await ensureParentIsValid({
    supabase,
    tenantId,
    versionId,
    parentId: nextParentId,
    itemId: currentItem.id,
  });
  const maxSectionDepth = clampMaxSectionDepth(
    version.max_section_depth,
    DEFAULT_MAX_SECTION_DEPTH
  );
  const parentSectionLevel = await resolveSectionLevelFromParent({
    supabase,
    tenantId,
    versionId,
    parent: nextParent,
  });
  const aidRegex = await resolveEstimateItemAidRegex({ tenantId, supabase });

  const targetItemType =
    "item_type" in input ? input.item_type : currentItem.item_type;
  const isConvertingLineToSection =
    currentItem.item_type === "line" && targetItemType === "section";
  const isConvertingSectionToLine =
    currentItem.item_type === "section" && targetItemType === "line";
  // Lot 2, sous-lot 2.8b (A8, D-b) : cette route ne recalcule rien ; la conversion d'une v3 y reste refusée par son nom,
  // avant toute écriture. Lot 3.2, entrée 1 : elle passe par un lot de l'écrivain v3 (suppression puis recréation).
  if ((isConvertingLineToSection || isConvertingSectionToLine) && usesPerUnitLabor(resolveEstimateEngineVersion(version))) {
    throw conflict(ESTIMATE_V3_ITEM_CONVERSION_REASON, undefined, "ESTIMATE_V3_ITEM_CONVERSION_UNAVAILABLE");
  }

  let hierarchyIndexForStructureChecks:
    | ReturnType<typeof buildHierarchyIndex>
    | null = null;
  const resolveHierarchyIndexForStructureChecks = async () => {
    if (hierarchyIndexForStructureChecks) {
      return hierarchyIndexForStructureChecks;
    }

    const hierarchyItems = await loadHierarchyItems({
      supabase,
      tenantId,
      versionId,
    });
    hierarchyIndexForStructureChecks = buildHierarchyIndex(hierarchyItems);
    return hierarchyIndexForStructureChecks;
  };

  if (targetItemType === "section") {
    const nextSectionLevel = parentSectionLevel === null ? 1 : parentSectionLevel + 1;
    assertSectionPlacementAllowed({
      maxSectionDepth,
      nextSectionLevel,
    });

    if (currentItem.item_type === "section") {
      const hierarchyIndex = await resolveHierarchyIndexForStructureChecks();
      if (isAncestorOrSelf(hierarchyIndex, currentItem.id, nextParentId)) {
        throw badRequest(
          "Une section ne peut pas être déplacée dans sa propre descendance."
        );
      }
      assertSectionSubtreePlacementAllowed({
        hierarchyIndex,
        sectionId: currentItem.id,
        nextSectionLevel,
        maxSectionDepth,
      });
    }

    const payload = prepareEstimateSectionUpdate({
      input, aidRegex, convertingLineToSection: isConvertingLineToSection,
    });

    const { data, error } = await supabase
      .from("estimate_items")
      .update(payload)
      .eq("tenant_id", tenantId)
      .eq("id", currentItem.id)
      .eq("version_id", versionId)
      .select("*")
      .single();

    if (error || !data) {
      if (error) {
        throw mapSupabaseError(error, "Impossible de mettre à jour la section.");
      }
      throw badRequest("Impossible de mettre à jour la section.");
    }

    return {
      item: data,
      version: await fetchEstimateVersionToken({ supabase, tenantId, versionId }),
      ...(isConvertingLineToSection
        ? { converted_from_item_type: "line" as const }
        : {}),
    };
  }

  const preparedLine = prepareEstimateLineUpdate({
    input, currentItem, versionTaxRateBp: version.tax_rate_bp, aidRegex,
  });
  const { fields } = preparedLine;

  assertLinePlacementAllowed({
    maxSectionDepth,
    parentSectionLevel,
  });

  if (isConvertingSectionToLine) {
    const { data: sectionChildren, error: sectionChildrenError } = await supabase
      .from("estimate_items")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("version_id", versionId)
      .eq("parent_id", currentItem.id)
      .limit(1);

    if (sectionChildrenError) {
      throw mapSupabaseError(
        sectionChildrenError,
        "Impossible de vérifier les enfants de la section."
      );
    }

    if ((sectionChildren ?? []).length > 0) {
      throw badRequest(
        "Une section avec enfants ne peut pas être convertie en ligne."
      );
    }
  }

  const [
    laborRateLegacyCents,
    laborRateAtelierCents,
    laborRateChantierCents,
  ] = await Promise.all([
    (async () => {
      await Promise.all([
        ensureCategoryIsValid(supabase, fields.category_id, context, project.user_id),
        ensureSupplyTypeIsValid(supabase, fields.supply_type_id, context),
        ensureProductIsValid(supabase, fields.product_id, context),
        ensureSupplierPriceIsValid(supabase, fields.selected_supplier_price_id, context),
      ]);
      return resolveLaborRateCents(
        supabase,
        fields.labor_role_id,
        context,
        project.user_id
      );
    })(),
    resolveLaborRateCents(
      supabase,
      fields.labor_role_atelier_id,
      context,
      project.user_id
    ),
    resolveLaborRateCents(
      supabase,
      fields.labor_role_chantier_id,
      context,
      project.user_id
    ),
  ]);

  const payload = calculateEstimateLineUpdate({
    preparedLine,
    marginMultiplier: version.margin_multiplier,
    laborRateLegacyCents, laborRateAtelierCents, laborRateChantierCents,
  });

  if (
    isUnifiedEngine(resolveCalcEngineVersion(version)) &&
    version.margin_mode === "tiered" &&
    !isConvertingSectionToLine
  ) {
    return persistTieredDraftLineUpdate({
      context,
      versionId,
      expectedUpdatedAt: version.updated_at,
      projectUserId: project.user_id,
      itemId: currentItem.id,
      payload,
    });
  }
  const { data, error } = await supabase
    .from("estimate_items")
    .update(payload)
    .eq("tenant_id", tenantId)
    .eq("id", currentItem.id)
    .eq("version_id", versionId)
    .select("*")
    .single();

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(error, "Impossible de mettre à jour la ligne.");
    }
    throw badRequest("Impossible de mettre à jour la ligne.");
  }

  return {
    item: data,
    version: await fetchEstimateVersionToken({ supabase, tenantId, versionId }),
    ...(isConvertingSectionToLine
      ? { converted_from_item_type: "section" as const }
      : {}),
  };
}
