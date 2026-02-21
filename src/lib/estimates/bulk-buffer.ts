type UpdatePayload = Record<string, unknown>;

export type BufferedUpdate<T extends UpdatePayload> = {
  id: string;
  updates: T;
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

export function shouldFlushBufferedUpdates(
  pendingUpdateCount: number,
  immediateFlushThreshold: number
) {
  return pendingUpdateCount >= immediateFlushThreshold;
}
