type EstimateNumberingItem = {
  id: string;
  parent_id: string | null;
  position: number;
};

function sortByPositionThenId(
  left: EstimateNumberingItem,
  right: EstimateNumberingItem
) {
  if (left.position !== right.position) {
    return left.position - right.position;
  }

  return left.id.localeCompare(right.id);
}

export function computeEstimateItemNumbering(
  sourceItems: readonly EstimateNumberingItem[]
) {
  const items = [...sourceItems];
  const idSet = new Set(items.map((item) => item.id));
  const childrenByParent = new Map<string, EstimateNumberingItem[]>();
  const numberingById: Record<string, string> = {};
  const visited = new Set<string>();

  items.forEach((item) => {
    if (!item.parent_id || !idSet.has(item.parent_id)) return;
    const siblings = childrenByParent.get(item.parent_id);
    if (siblings) {
      siblings.push(item);
      return;
    }
    childrenByParent.set(item.parent_id, [item]);
  });

  childrenByParent.forEach((siblings) => {
    siblings.sort(sortByPositionThenId);
  });

  const walkItem = (item: EstimateNumberingItem, segments: number[]) => {
    if (visited.has(item.id)) return;
    visited.add(item.id);
    numberingById[item.id] = segments.join(".");

    const children = childrenByParent.get(item.id) ?? [];
    children.forEach((child, index) => {
      walkItem(child, [...segments, index + 1]);
    });
  };

  const rootItems = items
    .filter((item) => item.parent_id === null)
    .sort(sortByPositionThenId);
  const orphanItems = items
    .filter((item) => item.parent_id !== null && !idSet.has(item.parent_id))
    .sort(sortByPositionThenId);

  let rootIndex = 0;
  rootItems.forEach((item) => {
    rootIndex += 1;
    walkItem(item, [rootIndex]);
  });

  orphanItems.forEach((item) => {
    rootIndex += 1;
    walkItem(item, [rootIndex]);
  });

  const orphanedCycleItems = items
    .filter((item) => !visited.has(item.id))
    .sort(sortByPositionThenId);

  orphanedCycleItems.forEach((item) => {
    rootIndex += 1;
    walkItem(item, [rootIndex]);
  });

  return numberingById;
}
