import { IN_FILTER_CHUNK_SIZE } from "./in-chunks";

export type CompleteRowsResult<Row, ErrorType> = {
  data: Row[] | null;
  error: ErrorType | null;
  count?: number | null;
};
export type CompleteRowsQuery<Row, ErrorType> = PromiseLike<CompleteRowsResult<Row, ErrorType>> & {
  order(column: string, options?: { ascending?: boolean }): CompleteRowsQuery<Row, ErrorType>;
  range(from: number, to: number): CompleteRowsQuery<Row, ErrorType>;
};
type ReadOptions = { limit?: number };
export type RowOrder = { column: string; ascending?: boolean; nullsFirst?: boolean };
const PAGE_SIZE = 500;
const IN_FILTER_ENCODED_BUDGET = 6000;

/** For SELECT only. Require count:exact and the row's primary key in the projection. */
export async function readAllRows<Row, ErrorType>(
  createQuery: () => CompleteRowsQuery<Row, ErrorType>,
  options: ReadOptions = {},
): Promise<CompleteRowsResult<Row, ErrorType>> {
  const limit = options.limit ?? Infinity;
  if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 1)) throw new Error("Limite de lecture invalide.");
  const query = createQuery().order("id", { ascending: true });
  const rows: Row[] = [];
  const ids = new Set<string | number>();
  let expectedCount: number | null = null;
  for (let offset = 0; offset < limit; offset += PAGE_SIZE) {
    const end = Math.min(offset + PAGE_SIZE, limit) - 1;
    const { data, error, count } = await query.range(offset, end);
    if (error) return { data: null, error, count: null };
    if (count == null || !Number.isSafeInteger(count) || count < 0 ||
      (expectedCount !== null && count !== expectedCount)) {
      throw new Error("Lecture incomplète ou modifiée : compte des lignes incohérent.");
    }
    expectedCount = count;
    const batch = data ?? [];
    for (const row of batch) {
      const id = (row as { id?: unknown }).id;
      if ((typeof id !== "string" && typeof id !== "number") || ids.has(id)) {
        throw new Error("Lecture incomplète ou modifiée : identités des lignes incohérentes.");
      }
      ids.add(id);
      rows.push(row);
    }
    const expected = Math.min(expectedCount, limit);
    if (rows.length > expected || batch.length > end - offset + 1) {
      throw new Error("Lecture incomplète ou modifiée : trop de lignes reçues.");
    }
    if (rows.length === expected) return { data: rows, error: null, count: expectedCount };
    if (batch.length < end - offset + 1) {
      throw new Error("Lecture incomplète : une page de résultats est tronquée.");
    }
  }
  throw new Error("Lecture incomplète des lignes.");
}

/** Bound IN URLs as well as the number of children returned by each filter. */
export async function readAllRowsInChunks<Row, ErrorType>(
  values: readonly string[],
  createQuery: (chunk: string[]) => CompleteRowsQuery<Row, ErrorType>,
  options: { order?: readonly RowOrder[] } = {},
): Promise<CompleteRowsResult<Row, ErrorType>> {
  const unique = [...new Set(values)];
  const rows: Row[] = [];
  let count = 0;
  for (let start = 0; start < unique.length;) {
    const chunk: string[] = [];
    let encodedLength = 0;
    while (start < unique.length && chunk.length < IN_FILTER_CHUNK_SIZE) {
      const value = unique[start];
      const length = encodeURIComponent(JSON.stringify(value)).length + 3;
      if (length > IN_FILTER_ENCODED_BUDGET) throw new Error("Valeur de filtre trop longue.");
      if (encodedLength + length > IN_FILTER_ENCODED_BUDGET) break;
      chunk.push(value);
      encodedLength += length;
      start++;
    }
    const result = await readAllRows(() => createQuery(chunk));
    if (result.error) return { data: null, error: result.error, count: null };
    rows.push(...(result.data ?? []));
    count += result.count ?? 0;
  }
  // Each row must belong to exactly one input bucket (PK or a scalar foreign key).
  if (new Set(rows.map(row => (row as { id: unknown }).id)).size !== rows.length) {
    throw new Error("Lecture incomplète ou modifiée : lignes dupliquées entre lots.");
  }
  if (options.order?.length) {
    rows.sort((left, right) => {
      for (const order of [...options.order!, { column: "id", ascending: true }]) {
        const a = (left as Record<string, unknown>)[order.column];
        const b = (right as Record<string, unknown>)[order.column];
        if (a === b) continue;
        const ascending = order.ascending !== false;
        const nullsFirst = order.nullsFirst ?? !ascending;
        if (a == null) return nullsFirst ? -1 : 1;
        if (b == null) return nullsFirst ? 1 : -1;
        const comparison = a < b ? -1 : a > b ? 1 : 0;
        if (comparison) return ascending ? comparison : -comparison;
      }
      return 0;
    });
  }
  return { data: rows, error: null, count };
}
