// Domain tests already model complete Supabase query results. Keep that boundary
// separate from the real-SDK transport fault regressions in read-all.test.ts.
export async function readAllRows<Result>(createQuery: () => PromiseLike<Result>) {
  return await createQuery();
}

export async function readAllRowsInChunks<Result>(
  values: readonly string[],
  createQuery: (values: string[]) => PromiseLike<Result>,
) {
  if (values.length === 0) return { data: [], error: null, count: 0 };
  return await createQuery([...new Set(values)]);
}
