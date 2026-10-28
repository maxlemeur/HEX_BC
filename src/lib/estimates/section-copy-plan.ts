import type { CopiedEstimateItem } from "@/lib/estimates/copy-items-server";
import { badRequest, internalError, notFound } from "@/lib/estimates/errors";
import type { EstimateItemRow } from "@/lib/estimates/version-read-server";

export function collectSectionSubtreeItems(
  sourceSectionId: string,
  sourceItems: EstimateItemRow[]
) {
  const sourceItemsById = new Map(
    sourceItems.map((item) => [item.id, item] as const)
  );
  const rootSection = sourceItemsById.get(sourceSectionId);
  if (!rootSection) {
    return null;
  }

  const childrenByParentId = new Map<string, EstimateItemRow[]>();
  for (const item of sourceItems) {
    const parentId = item.parent_id ?? null;
    if (!parentId) continue;

    const siblings = childrenByParentId.get(parentId);
    if (siblings) {
      siblings.push(item);
      continue;
    }

    childrenByParentId.set(parentId, [item]);
  }

  const orderedSubtreeItems: EstimateItemRow[] = [];
  const stack: string[] = [sourceSectionId];

  while (stack.length > 0) {
    const currentItemId = stack.pop();
    if (!currentItemId) continue;

    const currentItem = sourceItemsById.get(currentItemId);
    if (!currentItem) continue;

    orderedSubtreeItems.push(currentItem);

    const directChildren = childrenByParentId.get(currentItemId) ?? [];
    for (let index = directChildren.length - 1; index >= 0; index -= 1) {
      stack.push(directChildren[index].id);
    }
  }

  return {
    rootSection,
    orderedSubtreeItems,
  };
}

export function normalizeSectionTitleKey(value: string | null | undefined) {
  const normalized = toNullableText(value);
  if (!normalized) return "section";
  return normalized.toLowerCase();
}

export function resolveImportedSectionTitle(input: {
  sourceTitle: string | null | undefined;
  usedTitleKeys: ReadonlySet<string>;
}) {
  const fallbackTitle = "Section importée";
  const baseTitle = toNullableText(input.sourceTitle) ?? fallbackTitle;
  const baseKey = normalizeSectionTitleKey(baseTitle);

  if (!input.usedTitleKeys.has(baseKey)) {
    return baseTitle;
  }

  const firstImportedCandidate = `${baseTitle} (import)`;
  const firstImportedKey = normalizeSectionTitleKey(firstImportedCandidate);
  if (!input.usedTitleKeys.has(firstImportedKey)) {
    return firstImportedCandidate;
  }

  let suffix = 2;
  while (suffix < 10_000) {
    const candidate = `${baseTitle} (import ${suffix})`;
    const candidateKey = normalizeSectionTitleKey(candidate);
    if (!input.usedTitleKeys.has(candidateKey)) {
      return candidate;
    }
    suffix += 1;
  }

  return firstImportedCandidate;
}

function buildImportedEstimateItemInsert(input: {
  sourceItem: EstimateItemRow;
  itemId: string;
  tenantId: string;
  targetVersionId: string;
  parentId: string | null;
  position: number;
  title?: string;
}): CopiedEstimateItem {
  return {
    id: input.itemId,
    tenant_id: input.tenantId,
    version_id: input.targetVersionId,
    parent_id: input.parentId,
    item_type: input.sourceItem.item_type,
    position: input.position,
    title: input.title ?? input.sourceItem.title,
    aid: input.sourceItem.aid ?? null,
    description: input.sourceItem.description,
    quantity: input.sourceItem.quantity,
    unit_price_ht_cents: input.sourceItem.unit_price_ht_cents,
    tax_rate_bp: input.sourceItem.tax_rate_bp,
    k_fo: input.sourceItem.k_fo,
    h_mo: input.sourceItem.h_mo,
    h_mo_majoration: input.sourceItem.h_mo_majoration ?? null,
    k_mo: input.sourceItem.k_mo,
    h_mo_atelier: input.sourceItem.h_mo_atelier ?? null,
    k_mo_atelier: input.sourceItem.k_mo_atelier ?? null,
    labor_role_atelier_id: input.sourceItem.labor_role_atelier_id ?? null,
    h_mo_chantier: input.sourceItem.h_mo_chantier ?? null,
    k_mo_chantier: input.sourceItem.k_mo_chantier ?? null,
    labor_role_chantier_id: input.sourceItem.labor_role_chantier_id ?? null,
    pu_ht_cents: input.sourceItem.pu_ht_cents,
    labor_role_id: input.sourceItem.labor_role_id,
    category_id: input.sourceItem.category_id,
    supply_type_id: input.sourceItem.supply_type_id ?? null,
    selected_supplier_price_id: input.sourceItem.selected_supplier_price_id ?? null,
    source_provider: input.sourceItem.source_provider ?? null,
    source_job_id: input.sourceItem.source_job_id ?? null,
    source_file_name: input.sourceItem.source_file_name ?? null,
    source_page: input.sourceItem.source_page ?? null,
    source_metadata: input.sourceItem.source_metadata ?? {},
    line_total_ht_cents: input.sourceItem.line_total_ht_cents,
    line_tax_cents: input.sourceItem.line_tax_cents,
    line_total_ttc_cents: input.sourceItem.line_total_ttc_cents,
  };
}

export function buildImportedSubtreePayload(input: {
  subtree: {
    rootSection: EstimateItemRow;
    orderedSubtreeItems: EstimateItemRow[];
  };
  tenantId: string;
  targetVersionId: string;
  rootPosition: number;
  rootTitle: string;
  newIdBySourceId: ReadonlyMap<string, string>;
  failureMessage?: string;
}) {
  const newIdBySourceId = input.newIdBySourceId;
  const createdSectionIds: string[] = [];
  const createdLineIds: string[] = [];

  const items = input.subtree.orderedSubtreeItems.map((sourceItem) => {
    const newItemId = newIdBySourceId.get(sourceItem.id);
    if (!newItemId) {
      throw internalError(input.failureMessage ?? "Impossible d'importer la section.");
    }

    const isRoot = sourceItem.id === input.subtree.rootSection.id;
    const sourceParentId = sourceItem.parent_id ?? null;
    const newParentId = isRoot
      ? null
      : sourceParentId
        ? (newIdBySourceId.get(sourceParentId) ?? null)
        : null;

    if (!isRoot && sourceParentId && !newParentId) {
      throw internalError(input.failureMessage ?? "Impossible d'importer la section.");
    }

    const inserted = buildImportedEstimateItemInsert({
      sourceItem,
      itemId: newItemId,
      tenantId: input.tenantId,
      targetVersionId: input.targetVersionId,
      parentId: newParentId,
      position: isRoot ? input.rootPosition : sourceItem.position,
      title: isRoot ? input.rootTitle : undefined,
    });

    if (sourceItem.item_type === "section") {
      createdSectionIds.push(newItemId);
    } else {
      createdLineIds.push(newItemId);
    }

    return inserted;
  });

  return {
    items,
    new_id_by_source_id: newIdBySourceId,
    created_section_ids: createdSectionIds,
    created_line_ids: createdLineIds,
    line_count: createdLineIds.length,
  };
}

export type SectionCopySubtree = NonNullable<ReturnType<typeof collectSectionSubtreeItems>>;

/** Select each requested hierarchy once; descendants of another selected section are implicit. */
export function selectSectionImportSubtrees(sourceItems: EstimateItemRow[], selectedSectionIds: readonly string[]): SectionCopySubtree[] {
  const sourceItemById = new Map(sourceItems.map((item) => [item.id, item]));
  selectedSectionIds.forEach((sectionId) => {
    const sectionItem = sourceItemById.get(sectionId);
    if (!sectionItem || sectionItem.item_type !== "section") {
      throw badRequest(
        "section_ids contient un identifiant de section invalide."
      );
    }
  });

  const selectedSectionIdSet = new Set(selectedSectionIds);
  const rootSelectedSectionIds = selectedSectionIds.filter((sectionId) => {
    let parentId = sourceItemById.get(sectionId)?.parent_id ?? null;

    while (parentId) {
      if (selectedSectionIdSet.has(parentId)) {
        return false;
      }
      parentId = sourceItemById.get(parentId)?.parent_id ?? null;
    }

    return true;
  });

  return rootSelectedSectionIds.map((sectionId) => {
    const subtree = collectSectionSubtreeItems(sectionId, sourceItems);
    if (!subtree) throw notFound("Section source introuvable.");
    return subtree;
  });
}

/** Prepare append/merge payloads from stable source and target reads, without allocating identifiers or writing. */
export function prepareSectionsImport({ subtrees, targetItems, mode, tenantId, targetVersionId, newIdsBySubtree }: {
  subtrees: readonly SectionCopySubtree[];
  targetItems: readonly EstimateItemRow[];
  mode: "append" | "merge";
  tenantId: string;
  targetVersionId: string;
  newIdsBySubtree: readonly ReadonlyMap<string, string>[];
}) {
  const targetRootSectionIdByTitleKey = new Map<string, string>();
  const usedRootTitleKeys = new Set<string>();
  targetItems.forEach((item) => {
    if (item.item_type !== "section" || item.parent_id !== null) return;
    const titleKey = normalizeSectionTitleKey(item.title);
    usedRootTitleKeys.add(titleKey);
    if (!targetRootSectionIdByTitleKey.has(titleKey)) {
      targetRootSectionIdByTitleKey.set(titleKey, item.id);
    }
  });

  const rootParentPositionKey = "__root__";
  const highestPositionByParentKey = new Map<string, number>();
  targetItems.forEach((item) => {
    const parentKey = item.parent_id ?? rootParentPositionKey;
    const current = highestPositionByParentKey.get(parentKey) ?? 0;
    if (item.position > current) {
      highestPositionByParentKey.set(parentKey, item.position);
    }
  });

  const allocateNextPosition = (parentId: string | null) => {
    const parentKey = parentId ?? rootParentPositionKey;
    const nextPosition = (highestPositionByParentKey.get(parentKey) ?? 0) + 1;
    highestPositionByParentKey.set(parentKey, nextPosition);
    return nextPosition;
  };

  const importedItemsPayload: CopiedEstimateItem[] = [];
  const sourceIdByNewId = new Map<string, string>();
  const createdSectionIds: string[] = [];
  const createdLineIds: string[] = [];
  let importedLinesCount = 0;

  for (const [index, subtree] of subtrees.entries()) {
    const newIdBySourceId = newIdsBySubtree[index];
    if (!newIdBySourceId) throw internalError("Impossible d'importer la section.");

    const sourceRootTitle =
      toNullableText(subtree.rootSection.title) ?? "Section importée";
    const sourceRootTitleKey = normalizeSectionTitleKey(sourceRootTitle);

    if (mode === "merge") {
      const existingTargetSectionId =
        targetRootSectionIdByTitleKey.get(sourceRootTitleKey);

      if (existingTargetSectionId) {
        const sourceLines = subtree.orderedSubtreeItems.filter(
          (item) => item.item_type === "line"
        );

        sourceLines.forEach((sourceLine) => {
          const lineId = newIdBySourceId.get(sourceLine.id);
          if (!lineId) throw internalError("Impossible d'importer la section.");
          sourceIdByNewId.set(lineId, sourceLine.id);
          importedItemsPayload.push(
            buildImportedEstimateItemInsert({
              sourceItem: sourceLine,
              itemId: lineId,
              tenantId,
              targetVersionId: targetVersionId,
              parentId: existingTargetSectionId,
              position: allocateNextPosition(existingTargetSectionId),
            })
          );
          createdLineIds.push(lineId);
        });

        importedLinesCount += sourceLines.length;
        continue;
      }
    }

    const rootTitle =
      mode === "append"
        ? resolveImportedSectionTitle({
            sourceTitle: sourceRootTitle,
            usedTitleKeys: usedRootTitleKeys,
          })
        : sourceRootTitle;

    const importedSubtree = buildImportedSubtreePayload({
      subtree,
      tenantId,
      targetVersionId: targetVersionId,
      rootPosition: allocateNextPosition(null),
      rootTitle,
      newIdBySourceId,
    });

    importedItemsPayload.push(...importedSubtree.items);
    importedSubtree.new_id_by_source_id.forEach((newId, sourceId) => sourceIdByNewId.set(newId, sourceId));
    createdSectionIds.push(...importedSubtree.created_section_ids);
    createdLineIds.push(...importedSubtree.created_line_ids);
    importedLinesCount += importedSubtree.line_count;

    const createdRootSectionId = importedSubtree.created_section_ids[0];
    if (createdRootSectionId) {
      const rootTitleKey = normalizeSectionTitleKey(rootTitle);
      usedRootTitleKeys.add(rootTitleKey);
      if (!targetRootSectionIdByTitleKey.has(rootTitleKey)) {
        targetRootSectionIdByTitleKey.set(rootTitleKey, createdRootSectionId);
      }
    }
  }

  return {
    items: importedItemsPayload,
    sourceIdByNewId,
    createdSectionIds,
    createdLineIds,
    importedLinesCount,
    importedSectionsCount: subtrees.length,
  };
}

function toNullableText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
