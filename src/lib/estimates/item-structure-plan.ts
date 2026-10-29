import { badRequest, conflict, notFound } from "@/lib/estimates/errors";

/** Include the requested root and its descendants once, in traversal order. */
export function collectEstimateSubtreeIds(rootId: string,
  versionItems: readonly { id: string; parent_id: string | null }[]): string[] {
  if (!versionItems.some((item) => item.id === rootId)) {
    throw notFound("Élément de chiffrage introuvable.");
  }

  const children = new Map<string, string[]>();
  for (const item of versionItems) {
    if (!item.parent_id) continue;
    const siblings = children.get(item.parent_id) ?? [];
    siblings.push(item.id);
    children.set(item.parent_id, siblings);
  }
  const deletedIds = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (deletedIds.has(id)) continue;
    deletedIds.add(id);
    stack.push(...(children.get(id) ?? []));
  }

  return [...deletedIds];
}

export function assertEstimateReorderPermutation(siblingIds: readonly string[], orderedIds: readonly string[]) {
  if (siblingIds.length === 0) {
    throw notFound("Aucun élément à réordonner pour ce parent.");
  }

  const receivedSet = new Set(orderedIds);
  const expectedSet = new Set(siblingIds);

  const hasUnknownIds = orderedIds.some((id) => !expectedSet.has(id));
  const hasMissingIds = siblingIds.some((id) => !receivedSet.has(id));

  if (
    orderedIds.length !== siblingIds.length ||
    hasUnknownIds ||
    hasMissingIds
  ) {
    throw conflict("La liste de réordonnancement est obsolète.", {
      expected_ids: siblingIds,
      received_ids: orderedIds,
    });
  }

}

export function assertEstimateMovePermutation({ itemId, fromParentId, toParentId,
  expectedSourceIds, expectedTargetIds, orderedSourceIds, orderedTargetIds }: {
  itemId: string;
  fromParentId: string | null;
  toParentId: string | null;
  expectedSourceIds: readonly string[];
  expectedTargetIds: readonly string[];
  orderedSourceIds: readonly string[];
  orderedTargetIds: readonly string[];
}) {
  if (orderedSourceIds.includes(itemId)) {
    throw badRequest("ordered_source_ids ne doit pas contenir item_id.");
  }

  if (!orderedTargetIds.includes(itemId)) {
    throw badRequest("ordered_target_ids doit contenir item_id.");
  }

  const sourceReceivedSet = new Set(orderedSourceIds);
  const targetReceivedSet = new Set(orderedTargetIds);

  if (orderedSourceIds.some((id) => targetReceivedSet.has(id))) {
    throw badRequest(
      "ordered_source_ids et ordered_target_ids ne doivent pas se chevaucher."
    );
  }

  const sourceExpectedSet = new Set(expectedSourceIds);
  const targetExpectedSet = new Set(expectedTargetIds);

  const sourceHasUnknownIds = orderedSourceIds.some(
    (id) => !sourceExpectedSet.has(id)
  );
  const sourceHasMissingIds = expectedSourceIds.some(
    (id) => !sourceReceivedSet.has(id)
  );

  const targetHasUnknownIds = orderedTargetIds.some(
    (id) => !targetExpectedSet.has(id)
  );
  const targetHasMissingIds = expectedTargetIds.some(
    (id) => !targetReceivedSet.has(id)
  );

  if (
    orderedSourceIds.length !== expectedSourceIds.length ||
    sourceHasUnknownIds ||
    sourceHasMissingIds ||
    orderedTargetIds.length !== expectedTargetIds.length ||
    targetHasUnknownIds ||
    targetHasMissingIds
  ) {
    throw conflict("La liste de déplacement est obsolète.", {
      item_id: itemId,
      from_parent_id: fromParentId,
      to_parent_id: toParentId,
      expected_source_ids: expectedSourceIds,
      received_source_ids: orderedSourceIds,
      expected_target_ids: expectedTargetIds,
      received_target_ids: orderedTargetIds,
    });
  }

}
