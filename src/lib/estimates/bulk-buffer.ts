type UpdatePayload = Record<string, unknown>;

export type BufferedUpdate<T extends UpdatePayload> = {
  id: string;
  updates: T;
};

type IdentifiedRecord = {
  id: string;
};

export function upsertBufferedUpdate<T extends UpdatePayload>(
  buffer: Map<string, T>,
  itemId: string,
  updates: T
) {
  const existing = buffer.get(itemId);
  buffer.set(itemId, {
    ...(existing ?? ({} as T)),
    ...updates,
  });
}

export function serializeBufferedUpdates<T extends UpdatePayload>(
  buffer: Map<string, T>
): BufferedUpdate<T>[] {
  return Array.from(buffer.entries()).map(([id, updates]) => ({
    id,
    updates,
  }));
}

export function applyBufferedUpdatesToItems<
  TItem extends IdentifiedRecord,
  TUpdate extends UpdatePayload,
>(
  sourceItems: TItem[],
  bufferedUpdates: BufferedUpdate<TUpdate>[]
) {
  if (sourceItems.length === 0 || bufferedUpdates.length === 0) {
    return sourceItems;
  }

  const updatesById = new Map(
    bufferedUpdates.map((entry) => [entry.id, entry.updates] as const)
  );

  let changed = false;
  const nextItems = sourceItems.map((item) => {
    const updates = updatesById.get(item.id);
    if (!updates) return item;
    changed = true;
    return {
      ...item,
      ...updates,
    } as TItem;
  });

  return changed ? nextItems : sourceItems;
}

export function rehydrateBufferedUpdates<
  TItem extends IdentifiedRecord,
  TUpdate extends UpdatePayload,
>(
  sourceItems: TItem[],
  draftBufferedUpdates: BufferedUpdate<TUpdate>[],
  buffer: Map<string, TUpdate>
) {
  buffer.clear();
  draftBufferedUpdates.forEach((entry) => {
    upsertBufferedUpdate(buffer, entry.id, entry.updates);
  });

  const normalizedBufferedUpdates = serializeBufferedUpdates(buffer);
  const pendingUpdateCount = buffer.size;
  return {
    mergedItems: applyBufferedUpdatesToItems(sourceItems, normalizedBufferedUpdates),
    normalizedBufferedUpdates,
    pendingUpdateCount,
    hasPendingUpdates: pendingUpdateCount > 0,
  };
}

export function shouldFlushBufferedUpdates(
  pendingUpdateCount: number,
  immediateFlushThreshold: number
) {
  return pendingUpdateCount >= immediateFlushThreshold;
}
