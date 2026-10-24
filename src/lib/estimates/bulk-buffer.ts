type UpdatePayload = Record<string, unknown>;

/** Blurring an unchanged cell must not enqueue an autosave. */
export function matchesSyncedItemPayload(
  syncedPayload: UpdatePayload | undefined,
  payload: UpdatePayload
) {
  if (!syncedPayload) return false;
  return Object.entries(payload).every(
    ([key, value]) => key in syncedPayload && Object.is(syncedPayload[key] ?? null, value ?? null)
  );
}

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

/**
 * `deriveItem` completes an item rebuilt from its buffered inputs with what the server derives from them on write
 * (TI-534: the FO provision of a changed supply type), from the item as it was before the overlay.
 */
export type BufferedItemDerivation<TItem> = (source: TItem, merged: TItem) => TItem;

export function applyBufferedUpdatesToItems<
  TItem extends IdentifiedRecord,
  TUpdate extends UpdatePayload,
>(
  sourceItems: TItem[],
  bufferedUpdates: BufferedUpdate<TUpdate>[],
  deriveItem?: BufferedItemDerivation<TItem>
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
    const merged = {
      ...item,
      ...updates,
    } as TItem;
    return deriveItem ? deriveItem(item, merged) : merged;
  });

  return changed ? nextItems : sourceItems;
}

export function rehydrateBufferedUpdates<
  TItem extends IdentifiedRecord,
  TUpdate extends UpdatePayload,
>(
  sourceItems: TItem[],
  draftBufferedUpdates: BufferedUpdate<TUpdate>[],
  buffer: Map<string, TUpdate>,
  deriveItem?: BufferedItemDerivation<TItem>
) {
  buffer.clear();
  draftBufferedUpdates.forEach((entry) => {
    upsertBufferedUpdate(buffer, entry.id, entry.updates);
  });

  const normalizedBufferedUpdates = serializeBufferedUpdates(buffer);
  const pendingUpdateCount = buffer.size;
  return {
    mergedItems: applyBufferedUpdatesToItems(sourceItems, normalizedBufferedUpdates, deriveItem),
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
