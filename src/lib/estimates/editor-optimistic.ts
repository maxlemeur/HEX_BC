type OptimisticItemPatch = Record<string, unknown>;
type Merge<TBase, TPatch> = Omit<TBase, keyof TPatch> & TPatch;

export function reconcileCreatedItemWithLocalDraft<
  TCreated extends Record<string, unknown>,
  TPatch extends OptimisticItemPatch,
>(
  created: TCreated,
  localDraftPatch: TPatch,
  queuedPatch?: Partial<TPatch>
): Merge<TCreated, TPatch> & { _optimistic: false; _pendingCreate: false } {
  return {
    ...created,
    ...(queuedPatch ?? {}),
    ...localDraftPatch,
    _optimistic: false,
    _pendingCreate: false,
  } as Merge<TCreated, TPatch> & { _optimistic: false; _pendingCreate: false };
}

export function markTempItemsRemoved<TPatch>(
  tempIds: string[],
  removedTempItemIds: Set<string>,
  queuedPatchesByTempId: Map<string, TPatch>
) {
  const queuedPatchesSnapshot = new Map<string, TPatch | undefined>();
  tempIds.forEach((tempId) => {
    queuedPatchesSnapshot.set(tempId, queuedPatchesByTempId.get(tempId));
    removedTempItemIds.add(tempId);
    queuedPatchesByTempId.delete(tempId);
  });
  return queuedPatchesSnapshot;
}

export function rollbackRemovedTempItems<TPatch>(
  tempIds: string[],
  queuedPatchesSnapshot: Map<string, TPatch | undefined>,
  removedTempItemIds: Set<string>,
  queuedPatchesByTempId: Map<string, TPatch>
) {
  tempIds.forEach((tempId) => {
    removedTempItemIds.delete(tempId);
    const queuedPatch = queuedPatchesSnapshot.get(tempId);
    if (queuedPatch !== undefined) {
      queuedPatchesByTempId.set(tempId, queuedPatch);
    }
  });
}
