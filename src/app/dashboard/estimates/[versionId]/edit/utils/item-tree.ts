import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];

export function collectSubtreeItemIds(
  sourceItems: EstimateItem[],
  rootId: string
): Set<string> {
  const ids = new Set<string>();
  const childrenByParentId = new Map<string, EstimateItem[]>();

  sourceItems.forEach((item) => {
    const parentId = item.parent_id;
    if (!parentId) return;
    const siblings = childrenByParentId.get(parentId);
    if (siblings) {
      siblings.push(item);
      return;
    }
    childrenByParentId.set(parentId, [item]);
  });

  const stack = [rootId];
  while (stack.length > 0) {
    const nextId = stack.pop();
    if (!nextId || ids.has(nextId)) continue;
    ids.add(nextId);
    const children = childrenByParentId.get(nextId) ?? [];
    children.forEach((child) => {
      stack.push(child.id);
    });
  }

  return ids;
}

export function resolveTopLevelItemIds(sourceItems: EstimateItem[]): string[] {
  const idSet = new Set(sourceItems.map((item) => item.id));
  return sourceItems
    .filter((item) => !item.parent_id || !idSet.has(item.parent_id))
    .map((item) => item.id);
}

export function buildSiblingOrderByParent(sourceItems: EstimateItem[]) {
  const siblingsByParent = new Map<string | null, EstimateItem[]>();

  sourceItems.forEach((item) => {
    const parentId = item.parent_id ?? null;
    const siblings = siblingsByParent.get(parentId);
    if (siblings) {
      siblings.push(item);
      return;
    }
    siblingsByParent.set(parentId, [item]);
  });

  const orderedIdsByParent = new Map<string | null, string[]>();
  siblingsByParent.forEach((siblings, parentId) => {
    orderedIdsByParent.set(
      parentId,
      [...siblings]
        .sort((left, right) => left.position - right.position)
        .map((item) => item.id)
    );
  });

  return orderedIdsByParent;
}

export function sortItemsForTreeRecreation(sourceItems: EstimateItem[]) {
  const itemById = new Map(sourceItems.map((item) => [item.id, item]));
  const depthById = new Map<string, number>();

  const resolveDepth = (item: EstimateItem): number => {
    const cachedDepth = depthById.get(item.id);
    if (cachedDepth !== undefined) return cachedDepth;

    if (!item.parent_id) {
      depthById.set(item.id, 0);
      return 0;
    }

    const parent = itemById.get(item.parent_id);
    if (!parent) {
      depthById.set(item.id, 0);
      return 0;
    }

    const depth = resolveDepth(parent) + 1;
    depthById.set(item.id, depth);
    return depth;
  };

  return [...sourceItems].sort((left, right) => {
    const leftDepth = resolveDepth(left);
    const rightDepth = resolveDepth(right);
    if (leftDepth !== rightDepth) {
      return leftDepth - rightDepth;
    }
    if (left.parent_id !== right.parent_id) {
      return (left.parent_id ?? "").localeCompare(right.parent_id ?? "");
    }
    return left.position - right.position;
  });
}
