import type { Database } from "@/types/database";

export const MIN_SECTION_DEPTH = 1;
export const MAX_SECTION_DEPTH = 4;
export const DEFAULT_MAX_SECTION_DEPTH = 3;
export const LEGACY_EXISTING_ESTIMATE_MAX_SECTION_DEPTH = 2;

export const DEFAULT_SECTION_LEVEL_LABELS = [
  "Lot",
  "Chapitre",
  "Sous-chapitre",
  "Ouvrage",
] as const;

type EstimateItemType = Database["public"]["Tables"]["estimate_items"]["Row"]["item_type"];

export type HierarchyItemLike = {
  id: string;
  parent_id: string | null;
  item_type: EstimateItemType;
};

export type HierarchyIndex = {
  byId: Map<string, HierarchyItemLike>;
  childrenByParentId: Map<string, HierarchyItemLike[]>;
};

export type HierarchySubtreeMetrics = {
  maxSectionRelativeDepth: number;
  lineRelativeDepths: number[];
  hasChildren: boolean;
};

export function clampMaxSectionDepth(
  value: number | null | undefined,
  fallback = DEFAULT_MAX_SECTION_DEPTH
) {
  const safeFallback = Number.isFinite(fallback)
    ? Math.min(Math.max(Math.trunc(fallback), MIN_SECTION_DEPTH), MAX_SECTION_DEPTH)
    : DEFAULT_MAX_SECTION_DEPTH;

  if (!Number.isFinite(value ?? NaN)) return safeFallback;
  return Math.min(
    Math.max(Math.trunc(value ?? safeFallback), MIN_SECTION_DEPTH),
    MAX_SECTION_DEPTH
  );
}

export function getSectionLevelLabel(level: number) {
  if (!Number.isFinite(level)) return `Niveau ${MIN_SECTION_DEPTH}`;
  const normalizedLevel = Math.max(Math.trunc(level), MIN_SECTION_DEPTH);
  return (
    DEFAULT_SECTION_LEVEL_LABELS[normalizedLevel - 1] ?? `Niveau ${normalizedLevel}`
  );
}

export function getDefaultSectionTitleForLevel(level: number) {
  return `Nouveau ${getSectionLevelLabel(level).toLowerCase()}`;
}

export function formatAddSectionLabelForLevel(level: number) {
  return `+ Ajouter un ${getSectionLevelLabel(level)}`;
}

export function formatAddLineLabelForSectionLevel(level: number) {
  return `+ Ajouter une ligne ${getSectionLevelLabel(level)}`;
}

export function buildHierarchyIndex(items: readonly HierarchyItemLike[]): HierarchyIndex {
  const byId = new Map<string, HierarchyItemLike>();
  const childrenByParentId = new Map<string, HierarchyItemLike[]>();

  items.forEach((item) => {
    byId.set(item.id, item);
    if (!item.parent_id) return;
    const siblings = childrenByParentId.get(item.parent_id) ?? [];
    siblings.push(item);
    childrenByParentId.set(item.parent_id, siblings);
  });

  return {
    byId,
    childrenByParentId,
  };
}

export function resolveItemDepth(
  index: HierarchyIndex,
  itemId: string
): number | null {
  const startingItem = index.byId.get(itemId);
  if (!startingItem) return null;

  let depth = 0;
  let cursorParentId = startingItem.parent_id;
  let guard = 0;

  while (cursorParentId) {
    guard += 1;
    if (guard > 2000) return null;

    const parent = index.byId.get(cursorParentId);
    if (!parent) {
      return depth;
    }

    depth += 1;
    cursorParentId = parent.parent_id;
  }

  return depth;
}

export function resolveSectionLevel(
  index: HierarchyIndex,
  sectionId: string
): number | null {
  const section = index.byId.get(sectionId);
  if (!section || section.item_type !== "section") return null;
  const depth = resolveItemDepth(index, sectionId);
  if (depth === null) return null;
  return depth + 1;
}

export function isAncestorOrSelf(
  index: HierarchyIndex,
  ancestorId: string,
  candidateId: string | null
) {
  if (!candidateId) return false;
  if (ancestorId === candidateId) return true;

  let cursorId: string | null = candidateId;
  let guard = 0;

  while (cursorId) {
    guard += 1;
    if (guard > 2000) return false;

    if (cursorId === ancestorId) return true;
    const current = index.byId.get(cursorId);
    if (!current) return false;
    cursorId = current.parent_id;
  }

  return false;
}

export function collectSubtreeMetrics(
  index: HierarchyIndex,
  rootId: string
): HierarchySubtreeMetrics {
  const rootDepth = resolveItemDepth(index, rootId) ?? 0;
  const stack: string[] = [rootId];
  const visited = new Set<string>();
  const lineRelativeDepths: number[] = [];
  let maxSectionRelativeDepth = 0;
  let hasChildren = false;

  while (stack.length > 0) {
    const currentId = stack.pop();
    if (!currentId || visited.has(currentId)) continue;
    visited.add(currentId);

    const children = index.childrenByParentId.get(currentId) ?? [];
    if (children.length > 0) {
      hasChildren = true;
    }

    children.forEach((child) => {
      const childDepth = resolveItemDepth(index, child.id);
      const relativeDepth = Math.max((childDepth ?? rootDepth) - rootDepth, 0);

      if (child.item_type === "section") {
        maxSectionRelativeDepth = Math.max(maxSectionRelativeDepth, relativeDepth);
        stack.push(child.id);
        return;
      }

      lineRelativeDepths.push(relativeDepth);
      stack.push(child.id);
    });
  }

  return {
    maxSectionRelativeDepth,
    lineRelativeDepths,
    hasChildren,
  };
}

export function getSectionLevelFromDepth(depth: number) {
  if (!Number.isFinite(depth)) return MIN_SECTION_DEPTH;
  return Math.max(Math.trunc(depth) + 1, MIN_SECTION_DEPTH);
}
