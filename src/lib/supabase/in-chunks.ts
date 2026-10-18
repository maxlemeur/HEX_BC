/**
 * A PostgREST `in.(…)` filter travels in the request URL. Gateways cap request
 * headers (the Supabase native gateway answers 431 above about 16 KB, roughly
 * 430 UUIDs), so a filter built from every line of a large estimate must be
 * read in bounded chunks: 150 UUIDs (39 bytes each once encoded) keep the URL
 * around 6 KB.
 */
export const IN_FILTER_CHUNK_SIZE = 150;

/**
 * Runs `select` once per chunk of `values`, sequentially, and concatenates the
 * rows. The first error stops the read and is returned with no rows, as a
 * single failed request would be.
 */
export async function selectInChunks<Row, ErrorType>(
  values: readonly string[],
  select: (chunk: string[]) => PromiseLike<{ data: Row[] | null; error: ErrorType | null }>
): Promise<{ data: Row[]; error: ErrorType | null }> {
  const rows: Row[] = [];
  for (let start = 0; start < values.length; start += IN_FILTER_CHUNK_SIZE) {
    const { data, error } = await select(values.slice(start, start + IN_FILTER_CHUNK_SIZE));
    if (error) return { data: [], error };
    rows.push(...(data ?? []));
  }
  return { data: rows, error: null };
}
