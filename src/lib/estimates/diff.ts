import type { Database } from "@/types/database";

type EstimateVersionRow =
  Database["public"]["Tables"]["estimate_versions"]["Row"];
type EstimateItemRow =
  Database["public"]["Tables"]["estimate_items"]["Row"];
type LaborRoleRow =
  Database["public"]["Tables"]["labor_roles"]["Row"];
type EstimateCategoryRow =
  Database["public"]["Tables"]["estimate_categories"]["Row"];
type SupplyTypeRow =
  Database["public"]["Tables"]["supply_types"]["Row"];
type MarginTierRow =
  Database["public"]["Tables"]["margin_tiers"]["Row"];

type DiffEntityType = "section" | "line";
type DiffChangeType = "added" | "removed" | "modified";
type DiffFieldKind = "text" | "number" | "money" | "percent" | "reference";
type DiffReferenceDomain = "labor_role" | "category" | "supply_type";

type DiffFieldDefinition = {
  key: keyof EstimateItemRow;
  label: string;
  kind: DiffFieldKind;
  referenceDomain?: DiffReferenceDomain;
};

type IndexedDiffItem = {
  item: EstimateItemRow;
  entityType: DiffEntityType;
  title: string;
  order: number;
};

type DiffTree = {
  childrenByParent: Map<string, IndexedDiffItem[]>;
};

type AlignedSiblingPair = {
  previousNode: IndexedDiffItem | null;
  currentNode: IndexedDiffItem | null;
  fieldChanges: EstimateDiffFieldChange[];
};

type ReferenceLookups = {
  laborRolesById: Map<string, string>;
  categoriesById: Map<string, string>;
  supplyTypesById: Map<string, string>;
};

const ROOT_PARENT_KEY = "__root__";
const INSERT_OR_REMOVE_COST = 12;

const SECTION_FIELD_DEFINITIONS: readonly DiffFieldDefinition[] = [
  {
    key: "title",
    label: "Titre",
    kind: "text",
  },
  {
    key: "description",
    label: "Description",
    kind: "text",
  },
];

const LINE_FIELD_DEFINITIONS: readonly DiffFieldDefinition[] = [
  {
    key: "title",
    label: "Désignation",
    kind: "text",
  },
  {
    key: "description",
    label: "Description",
    kind: "text",
  },
  {
    key: "quantity",
    label: "Quantité",
    kind: "number",
  },
  {
    key: "unit_price_ht_cents",
    label: "Prix unitaire HT",
    kind: "money",
  },
  {
    key: "k_fo",
    label: "K FO",
    kind: "number",
  },
  {
    key: "h_mo",
    label: "H MO",
    kind: "number",
  },
  {
    key: "h_mo_majoration",
    label: "Majoration MO",
    kind: "number",
  },
  {
    key: "k_mo",
    label: "K MO",
    kind: "number",
  },
  {
    key: "h_mo_atelier",
    label: "H MO atelier",
    kind: "number",
  },
  {
    key: "k_mo_atelier",
    label: "K MO atelier",
    kind: "number",
  },
  {
    key: "h_mo_chantier",
    label: "H MO chantier",
    kind: "number",
  },
  {
    key: "k_mo_chantier",
    label: "K MO chantier",
    kind: "number",
  },
  {
    key: "labor_role_id",
    label: "Role MO",
    kind: "reference",
    referenceDomain: "labor_role",
  },
  {
    key: "labor_role_atelier_id",
    label: "Role atelier",
    kind: "reference",
    referenceDomain: "labor_role",
  },
  {
    key: "labor_role_chantier_id",
    label: "Role chantier",
    kind: "reference",
    referenceDomain: "labor_role",
  },
  {
    key: "category_id",
    label: "Categorie",
    kind: "reference",
    referenceDomain: "category",
  },
  {
    key: "supply_type_id",
    label: "Type fourniture",
    kind: "reference",
    referenceDomain: "supply_type",
  },
  {
    key: "tax_rate_bp",
    label: "TVA",
    kind: "percent",
  },
  {
    key: "pu_ht_cents",
    label: "PU HT",
    kind: "money",
  },
  {
    key: "line_total_ht_cents",
    label: "Total HT",
    kind: "money",
  },
  {
    key: "line_tax_cents",
    label: "Total TVA",
    kind: "money",
  },
  {
    key: "line_total_ttc_cents",
    label: "Total TTC",
    kind: "money",
  },
];

export type EstimateDiffMode = "inline" | "side-by-side";

export type EstimateVersionDetailsForDiff = {
  version: EstimateVersionRow;
  items: EstimateItemRow[];
  labor_roles: LaborRoleRow[];
  categories: EstimateCategoryRow[];
  supply_types: SupplyTypeRow[];
  margin_tiers: MarginTierRow[];
};

export type EstimateDiffFieldChange = {
  field: string;
  label: string;
  kind: DiffFieldKind;
  beforeValue: string | number | null;
  afterValue: string | number | null;
};

export type EstimateDiffEntry = {
  key: string;
  entityType: DiffEntityType;
  changeType: DiffChangeType;
  sectionPath: string[];
  title: string;
  beforeItem: EstimateItemRow | null;
  afterItem: EstimateItemRow | null;
  fieldChanges: EstimateDiffFieldChange[];
  sortOrder: number;
};

export type EstimateDiffComputedTotals = {
  totalHtCents: number;
  totalTtcCents: number;
};

export type EstimateDiffSummary = {
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
  deltaHtCents: number;
  deltaTtcCents: number;
  previousTotals: EstimateDiffComputedTotals;
  currentTotals: EstimateDiffComputedTotals;
};

export type EstimateDiffResult = {
  entries: EstimateDiffEntry[];
  summary: EstimateDiffSummary;
};

function normalizeStringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNumberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return Object.is(parsed, -0) ? 0 : parsed;
    }
  }
  return null;
}

function normalizeComparableValue(
  value: unknown,
  kind: DiffFieldKind
): string | number | null {
  if (kind === "text" || kind === "reference") {
    return normalizeStringValue(value);
  }
  return normalizeNumberValue(value);
}

function areComparableValuesEqual(
  left: string | number | null,
  right: string | number | null
) {
  if (left === right) return true;
  if (left === null || right === null) return false;
  if (typeof left === "number" && typeof right === "number") {
    return Object.is(left, right);
  }
  return String(left) === String(right);
}

function buildReferenceLookups(
  previous: EstimateVersionDetailsForDiff,
  current: EstimateVersionDetailsForDiff
): ReferenceLookups {
  const laborRolesById = new Map<string, string>();
  const categoriesById = new Map<string, string>();
  const supplyTypesById = new Map<string, string>();

  const allLaborRoles = [...previous.labor_roles, ...current.labor_roles];
  allLaborRoles.forEach((role) => {
    const name = normalizeStringValue(role.name);
    laborRolesById.set(role.id, name ?? role.id);
  });

  const allCategories = [...previous.categories, ...current.categories];
  allCategories.forEach((category) => {
    const name = normalizeStringValue(category.name);
    categoriesById.set(category.id, name ?? category.id);
  });

  const allSupplyTypes = [...previous.supply_types, ...current.supply_types];
  allSupplyTypes.forEach((supplyType) => {
    const name = normalizeStringValue(supplyType.name);
    supplyTypesById.set(supplyType.id, name ?? supplyType.id);
  });

  return {
    laborRolesById,
    categoriesById,
    supplyTypesById,
  };
}

function resolveReferenceLabel(
  value: string | null,
  definition: DiffFieldDefinition,
  lookups: ReferenceLookups
): string | null {
  if (!value || !definition.referenceDomain) return value;
  if (definition.referenceDomain === "labor_role") {
    return lookups.laborRolesById.get(value) ?? value;
  }
  if (definition.referenceDomain === "category") {
    return lookups.categoriesById.get(value) ?? value;
  }
  if (definition.referenceDomain === "supply_type") {
    return lookups.supplyTypesById.get(value) ?? value;
  }
  return value;
}

function resolveDisplayValue(
  value: unknown,
  definition: DiffFieldDefinition,
  lookups: ReferenceLookups
): string | number | null {
  if (definition.kind === "text" || definition.kind === "reference") {
    const normalized = normalizeStringValue(value);
    if (!normalized) return null;
    if (definition.kind === "reference") {
      return resolveReferenceLabel(normalized, definition, lookups);
    }
    return normalized;
  }

  return normalizeNumberValue(value);
}

function buildFieldChanges({
  beforeItem,
  afterItem,
  entityType,
  lookups,
}: {
  beforeItem: EstimateItemRow;
  afterItem: EstimateItemRow;
  entityType: DiffEntityType;
  lookups: ReferenceLookups;
}): EstimateDiffFieldChange[] {
  const fieldDefinitions =
    entityType === "section" ? SECTION_FIELD_DEFINITIONS : LINE_FIELD_DEFINITIONS;

  const changes: EstimateDiffFieldChange[] = [];

  fieldDefinitions.forEach((definition) => {
    const beforeComparable = normalizeComparableValue(
      beforeItem[definition.key],
      definition.kind
    );
    const afterComparable = normalizeComparableValue(
      afterItem[definition.key],
      definition.kind
    );

    if (areComparableValuesEqual(beforeComparable, afterComparable)) {
      return;
    }

    changes.push({
      field: definition.key,
      label: definition.label,
      kind: definition.kind,
      beforeValue: resolveDisplayValue(beforeItem[definition.key], definition, lookups),
      afterValue: resolveDisplayValue(afterItem[definition.key], definition, lookups),
    });
  });

  return changes;
}

function getParentKey(parentId: string | null) {
  return parentId ?? ROOT_PARENT_KEY;
}

function buildDiffTree(items: EstimateItemRow[]): DiffTree {
  const groupedByParent = new Map<string, EstimateItemRow[]>();
  items.forEach((item) => {
    const key = getParentKey(item.parent_id);
    const siblings = groupedByParent.get(key) ?? [];
    siblings.push(item);
    groupedByParent.set(key, siblings);
  });

  groupedByParent.forEach((siblings) => {
    siblings.sort((left, right) => {
      if (left.position !== right.position) {
        return left.position - right.position;
      }
      return left.id.localeCompare(right.id);
    });
  });

  const childrenByParent = new Map<string, IndexedDiffItem[]>();
  const visitedSections = new Set<string>();
  let order = 0;

  const walk = (parentId: string | null) => {
    const siblings = groupedByParent.get(getParentKey(parentId)) ?? [];
    const indexedSiblings: IndexedDiffItem[] = [];

    siblings.forEach((item) => {
      const title = item.title.trim();
      const entityType: DiffEntityType =
        item.item_type === "section" ? "section" : "line";

      const indexedItem: IndexedDiffItem = {
        item,
        entityType,
        title,
        order,
      };

      indexedSiblings.push(indexedItem);
      order += 1;

      if (item.item_type === "section") {
        if (visitedSections.has(item.id)) {
          return;
        }

        visitedSections.add(item.id);
        walk(item.id);
      }
    });

    childrenByParent.set(getParentKey(parentId), indexedSiblings);
  };

  walk(null);
  return {
    childrenByParent,
  };
}

function getChildrenByParent(
  tree: DiffTree,
  parentId: string | null
): IndexedDiffItem[] {
  return tree.childrenByParent.get(getParentKey(parentId)) ?? [];
}

function getFieldChangesForPair(input: {
  previousNode: IndexedDiffItem;
  currentNode: IndexedDiffItem;
  lookups: ReferenceLookups;
  fieldChangesByPair: Map<string, EstimateDiffFieldChange[]>;
}): EstimateDiffFieldChange[] {
  const cacheKey = `${input.previousNode.item.id}:${input.currentNode.item.id}`;
  const cached = input.fieldChangesByPair.get(cacheKey);
  if (cached) {
    return cached;
  }

  const fieldChanges = buildFieldChanges({
    beforeItem: input.previousNode.item,
    afterItem: input.currentNode.item,
    entityType: input.previousNode.entityType,
    lookups: input.lookups,
  });
  input.fieldChangesByPair.set(cacheKey, fieldChanges);
  return fieldChanges;
}

function alignSiblingPairs(input: {
  previousSiblings: IndexedDiffItem[];
  currentSiblings: IndexedDiffItem[];
  lookups: ReferenceLookups;
  fieldChangesByPair: Map<string, EstimateDiffFieldChange[]>;
}): AlignedSiblingPair[] {
  const { previousSiblings, currentSiblings, lookups, fieldChangesByPair } = input;
  const previousLength = previousSiblings.length;
  const currentLength = currentSiblings.length;

  const costs = Array.from({ length: previousLength + 1 }, () =>
    Array<number>(currentLength + 1).fill(0)
  );
  const choices = Array.from({ length: previousLength + 1 }, () =>
    Array<"match" | "remove" | "add">(currentLength + 1).fill("match")
  );

  for (let i = 1; i <= previousLength; i += 1) {
    costs[i][0] = i * INSERT_OR_REMOVE_COST;
    choices[i][0] = "remove";
  }

  for (let j = 1; j <= currentLength; j += 1) {
    costs[0][j] = j * INSERT_OR_REMOVE_COST;
    choices[0][j] = "add";
  }

  for (let i = 1; i <= previousLength; i += 1) {
    for (let j = 1; j <= currentLength; j += 1) {
      const previousNode = previousSiblings[i - 1];
      const currentNode = currentSiblings[j - 1];

      let matchCost = Number.POSITIVE_INFINITY;
      if (previousNode.entityType === currentNode.entityType) {
        const fieldChanges = getFieldChangesForPair({
          previousNode,
          currentNode,
          lookups,
          fieldChangesByPair,
        });
        matchCost = costs[i - 1][j - 1] + fieldChanges.length;
      }

      const removeCost = costs[i - 1][j] + INSERT_OR_REMOVE_COST;
      const addCost = costs[i][j - 1] + INSERT_OR_REMOVE_COST;

      let bestCost = matchCost;
      let bestChoice: "match" | "remove" | "add" = "match";

      if (removeCost < bestCost) {
        bestCost = removeCost;
        bestChoice = "remove";
      }

      if (addCost < bestCost) {
        bestCost = addCost;
        bestChoice = "add";
      }

      costs[i][j] = bestCost;
      choices[i][j] = bestChoice;
    }
  }

  const aligned: AlignedSiblingPair[] = [];
  let i = previousLength;
  let j = currentLength;

  while (i > 0 || j > 0) {
    const choice = choices[i][j];

    if (choice === "match" && i > 0 && j > 0) {
      const previousNode = previousSiblings[i - 1];
      const currentNode = currentSiblings[j - 1];
      aligned.push({
        previousNode,
        currentNode,
        fieldChanges: getFieldChangesForPair({
          previousNode,
          currentNode,
          lookups,
          fieldChangesByPair,
        }),
      });
      i -= 1;
      j -= 1;
      continue;
    }

    if (choice === "remove" && i > 0) {
      aligned.push({
        previousNode: previousSiblings[i - 1],
        currentNode: null,
        fieldChanges: [],
      });
      i -= 1;
      continue;
    }

    if (j > 0) {
      aligned.push({
        previousNode: null,
        currentNode: currentSiblings[j - 1],
        fieldChanges: [],
      });
      j -= 1;
      continue;
    }

    aligned.push({
      previousNode: previousSiblings[i - 1],
      currentNode: null,
      fieldChanges: [],
    });
    i -= 1;
  }

  return aligned.reverse();
}

function computeVersionTotals(
  details: EstimateVersionDetailsForDiff
): EstimateDiffComputedTotals {
  return {
    totalHtCents: details.version.total_ht_cents,
    totalTtcCents: details.version.total_ttc_cents,
  };
}

function compareDiffEntries(left: EstimateDiffEntry, right: EstimateDiffEntry) {
  if (left.sortOrder !== right.sortOrder) {
    return left.sortOrder - right.sortOrder;
  }

  const pathCompare = left.sectionPath
    .join(" > ")
    .localeCompare(right.sectionPath.join(" > "), "fr");
  if (pathCompare !== 0) {
    return pathCompare;
  }

  if (left.entityType !== right.entityType) {
    return left.entityType === "section" ? -1 : 1;
  }

  return left.title.localeCompare(right.title, "fr");
}

function toEntrySortOrder(
  previousNode: IndexedDiffItem | null,
  currentNode: IndexedDiffItem | null
) {
  if (currentNode) {
    return currentNode.order * 2;
  }
  if (previousNode) {
    return previousNode.order * 2 + 1;
  }
  return Number.MAX_SAFE_INTEGER;
}

export function normalizeEstimateDiffMode(
  value: string | null | undefined
): EstimateDiffMode {
  return value === "side-by-side" ? "side-by-side" : "inline";
}

export function buildEstimateDiff(input: {
  previous: EstimateVersionDetailsForDiff;
  current: EstimateVersionDetailsForDiff;
}): EstimateDiffResult {
  const previousTree = buildDiffTree(input.previous.items);
  const currentTree = buildDiffTree(input.current.items);

  const lookups = buildReferenceLookups(input.previous, input.current);
  const fieldChangesByPair = new Map<string, EstimateDiffFieldChange[]>();
  const entries: EstimateDiffEntry[] = [];

  const appendAddedSubtree = (
    currentNode: IndexedDiffItem,
    currentSectionPath: string[]
  ) => {
    entries.push({
      key: `added:${currentNode.item.id}`,
      entityType: currentNode.entityType,
      changeType: "added",
      sectionPath: [...currentSectionPath],
      title: currentNode.title,
      beforeItem: null,
      afterItem: currentNode.item,
      fieldChanges: [],
      sortOrder: toEntrySortOrder(null, currentNode),
    });

    if (currentNode.entityType !== "section") {
      return;
    }

    const nextPath = [...currentSectionPath, currentNode.title];
    const children = getChildrenByParent(currentTree, currentNode.item.id);
    children.forEach((childNode) => {
      appendAddedSubtree(childNode, nextPath);
    });
  };

  const appendRemovedSubtree = (
    previousNode: IndexedDiffItem,
    previousSectionPath: string[]
  ) => {
    entries.push({
      key: `removed:${previousNode.item.id}`,
      entityType: previousNode.entityType,
      changeType: "removed",
      sectionPath: [...previousSectionPath],
      title: previousNode.title,
      beforeItem: previousNode.item,
      afterItem: null,
      fieldChanges: [],
      sortOrder: toEntrySortOrder(previousNode, null),
    });

    if (previousNode.entityType !== "section") {
      return;
    }

    const nextPath = [...previousSectionPath, previousNode.title];
    const children = getChildrenByParent(previousTree, previousNode.item.id);
    children.forEach((childNode) => {
      appendRemovedSubtree(childNode, nextPath);
    });
  };

  const diffSiblings = (inputSiblings: {
    previousParentId: string | null;
    currentParentId: string | null;
    previousSectionPath: string[];
    currentSectionPath: string[];
  }) => {
    const previousSiblings = getChildrenByParent(
      previousTree,
      inputSiblings.previousParentId
    );
    const currentSiblings = getChildrenByParent(
      currentTree,
      inputSiblings.currentParentId
    );

    const alignedPairs = alignSiblingPairs({
      previousSiblings,
      currentSiblings,
      lookups,
      fieldChangesByPair,
    });

    alignedPairs.forEach((alignedPair) => {
      if (alignedPair.previousNode && alignedPair.currentNode) {
        if (alignedPair.fieldChanges.length > 0) {
          entries.push({
            key: `modified:${alignedPair.previousNode.item.id}:${alignedPair.currentNode.item.id}`,
            entityType: alignedPair.currentNode.entityType,
            changeType: "modified",
            sectionPath: [...inputSiblings.currentSectionPath],
            title: alignedPair.currentNode.title,
            beforeItem: alignedPair.previousNode.item,
            afterItem: alignedPair.currentNode.item,
            fieldChanges: alignedPair.fieldChanges,
            sortOrder: toEntrySortOrder(
              alignedPair.previousNode,
              alignedPair.currentNode
            ),
          });
        }

        if (alignedPair.currentNode.entityType === "section") {
          diffSiblings({
            previousParentId: alignedPair.previousNode.item.id,
            currentParentId: alignedPair.currentNode.item.id,
            previousSectionPath: [
              ...inputSiblings.previousSectionPath,
              alignedPair.previousNode.title,
            ],
            currentSectionPath: [
              ...inputSiblings.currentSectionPath,
              alignedPair.currentNode.title,
            ],
          });
        }

        return;
      }

      if (alignedPair.previousNode) {
        appendRemovedSubtree(
          alignedPair.previousNode,
          inputSiblings.previousSectionPath
        );
        return;
      }

      if (alignedPair.currentNode) {
        appendAddedSubtree(alignedPair.currentNode, inputSiblings.currentSectionPath);
      }
    });
  };

  diffSiblings({
    previousParentId: null,
    currentParentId: null,
    previousSectionPath: [],
    currentSectionPath: [],
  });

  const sortedEntries = [...entries].sort(compareDiffEntries);
  const previousTotals = computeVersionTotals(input.previous);
  const currentTotals = computeVersionTotals(input.current);

  const summary: EstimateDiffSummary = {
    addedCount: sortedEntries.filter((entry) => entry.changeType === "added").length,
    removedCount: sortedEntries.filter((entry) => entry.changeType === "removed").length,
    modifiedCount: sortedEntries.filter((entry) => entry.changeType === "modified").length,
    deltaHtCents: currentTotals.totalHtCents - previousTotals.totalHtCents,
    deltaTtcCents: currentTotals.totalTtcCents - previousTotals.totalTtcCents,
    previousTotals,
    currentTotals,
  };

  return {
    entries: sortedEntries,
    summary,
  };
}
