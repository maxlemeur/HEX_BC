import { computeEstimateTotals } from "@/lib/estimate-calculations";
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

type EstimateLineWithLaborRates = EstimateItemRow & {
  labor_role_hourly_rate_cents?: number | null;
  labor_role_atelier_hourly_rate_cents?: number | null;
  labor_role_chantier_hourly_rate_cents?: number | null;
};

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
  matchKey: string;
  item: EstimateItemRow;
  entityType: DiffEntityType;
  title: string;
  sectionPath: string[];
  order: number;
};

type ReferenceLookups = {
  laborRolesById: Map<string, string>;
  categoriesById: Map<string, string>;
  supplyTypesById: Map<string, string>;
};

const ROOT_PARENT_KEY = "__root__";

const SECTION_FIELD_DEFINITIONS: readonly DiffFieldDefinition[] = [
  {
    key: "description",
    label: "Description",
    kind: "text",
  },
];

const LINE_FIELD_DEFINITIONS: readonly DiffFieldDefinition[] = [
  {
    key: "description",
    label: "Description",
    kind: "text",
  },
  {
    key: "quantity",
    label: "Quantite",
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

function normalizeText(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

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

function buildMatchBaseKey(
  entityType: DiffEntityType,
  sectionPath: string[],
  title: string
) {
  const normalizedPath = sectionPath.map((segment) => normalizeText(segment)).join(">");
  return `${entityType}|${normalizedPath}|${normalizeText(title)}`;
}

function buildIndexedItems(items: EstimateItemRow[]): IndexedDiffItem[] {
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

  const indexed: IndexedDiffItem[] = [];
  const occurrenceByBaseKey = new Map<string, number>();
  const visitedSections = new Set<string>();
  let order = 0;

  const walk = (parentId: string | null, sectionPath: string[]) => {
    const siblings = groupedByParent.get(getParentKey(parentId)) ?? [];

    siblings.forEach((item) => {
      const title = item.title.trim();

      if (item.item_type === "section") {
        const baseKey = buildMatchBaseKey("section", sectionPath, title);
        const occurrence = occurrenceByBaseKey.get(baseKey) ?? 0;
        occurrenceByBaseKey.set(baseKey, occurrence + 1);

        indexed.push({
          matchKey: `${baseKey}#${occurrence}`,
          item,
          entityType: "section",
          title,
          sectionPath: [...sectionPath],
          order,
        });

        order += 1;

        if (visitedSections.has(item.id)) {
          return;
        }

        visitedSections.add(item.id);
        walk(item.id, [...sectionPath, title]);
        return;
      }

      const baseKey = buildMatchBaseKey("line", sectionPath, title);
      const occurrence = occurrenceByBaseKey.get(baseKey) ?? 0;
      occurrenceByBaseKey.set(baseKey, occurrence + 1);

      indexed.push({
        matchKey: `${baseKey}#${occurrence}`,
        item,
        entityType: "line",
        title,
        sectionPath: [...sectionPath],
        order,
      });

      order += 1;
    });
  };

  walk(null, []);
  return indexed;
}

function buildRateMap(roles: LaborRoleRow[]) {
  const rateById = new Map<string, number>();
  roles.forEach((role) => {
    rateById.set(role.id, role.hourly_rate_cents ?? 0);
  });
  return rateById;
}

function buildLineItemsWithRates(
  details: EstimateVersionDetailsForDiff
): EstimateLineWithLaborRates[] {
  const rateById = buildRateMap(details.labor_roles);

  return details.items
    .filter((item): item is EstimateItemRow => item.item_type === "line")
    .map((item) => ({
      ...item,
      labor_role_hourly_rate_cents: item.labor_role_id
        ? (rateById.get(item.labor_role_id) ?? 0)
        : 0,
      labor_role_atelier_hourly_rate_cents: item.labor_role_atelier_id
        ? (rateById.get(item.labor_role_atelier_id) ?? 0)
        : 0,
      labor_role_chantier_hourly_rate_cents: item.labor_role_chantier_id
        ? (rateById.get(item.labor_role_chantier_id) ?? 0)
        : 0,
    }));
}

function computeVersionTotals(
  details: EstimateVersionDetailsForDiff
): EstimateDiffComputedTotals {
  const lineItems = buildLineItemsWithRates(details);

  const totalsInputBase = {
    lineItems,
    marginMultiplier: details.version.margin_multiplier,
    marginMode: details.version.margin_mode,
    marginTiers: details.margin_tiers,
    discountCents: 0,
    taxRateBp: details.version.tax_rate_bp,
    roundingMode: details.version.rounding_mode,
    roundingStepCents: details.version.rounding_step_cents,
  } as const;

  const subtotalTotals = computeEstimateTotals(totalsInputBase);
  const discountCents = Math.round(
    (subtotalTotals.saleSubtotalCents * details.version.discount_bp) / 10000
  );
  const totals = computeEstimateTotals({
    ...totalsInputBase,
    discountCents,
  });

  return {
    totalHtCents: totals.saleTotalCents,
    totalTtcCents: totals.roundedTtcCents,
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
  const previousIndexedItems = buildIndexedItems(input.previous.items);
  const currentIndexedItems = buildIndexedItems(input.current.items);

  const previousByMatchKey = new Map<string, IndexedDiffItem>();
  previousIndexedItems.forEach((indexedItem) => {
    previousByMatchKey.set(indexedItem.matchKey, indexedItem);
  });

  const currentByMatchKey = new Map<string, IndexedDiffItem>();
  currentIndexedItems.forEach((indexedItem) => {
    currentByMatchKey.set(indexedItem.matchKey, indexedItem);
  });

  const lookups = buildReferenceLookups(input.previous, input.current);
  const allMatchKeys = new Set([
    ...previousByMatchKey.keys(),
    ...currentByMatchKey.keys(),
  ]);

  const entries: EstimateDiffEntry[] = [];

  allMatchKeys.forEach((matchKey) => {
    const previousNode = previousByMatchKey.get(matchKey) ?? null;
    const currentNode = currentByMatchKey.get(matchKey) ?? null;
    const sourceNode = currentNode ?? previousNode;

    if (!sourceNode) return;

    if (!previousNode && currentNode) {
      entries.push({
        key: matchKey,
        entityType: currentNode.entityType,
        changeType: "added",
        sectionPath: currentNode.sectionPath,
        title: currentNode.title,
        beforeItem: null,
        afterItem: currentNode.item,
        fieldChanges: [],
        sortOrder: toEntrySortOrder(previousNode, currentNode),
      });
      return;
    }

    if (previousNode && !currentNode) {
      entries.push({
        key: matchKey,
        entityType: previousNode.entityType,
        changeType: "removed",
        sectionPath: previousNode.sectionPath,
        title: previousNode.title,
        beforeItem: previousNode.item,
        afterItem: null,
        fieldChanges: [],
        sortOrder: toEntrySortOrder(previousNode, currentNode),
      });
      return;
    }

    if (!previousNode || !currentNode) {
      return;
    }

    const fieldChanges = buildFieldChanges({
      beforeItem: previousNode.item,
      afterItem: currentNode.item,
      entityType: sourceNode.entityType,
      lookups,
    });

    if (fieldChanges.length === 0) {
      return;
    }

    entries.push({
      key: matchKey,
      entityType: sourceNode.entityType,
      changeType: "modified",
      sectionPath: sourceNode.sectionPath,
      title: sourceNode.title,
      beforeItem: previousNode.item,
      afterItem: currentNode.item,
      fieldChanges,
      sortOrder: toEntrySortOrder(previousNode, currentNode),
    });
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
