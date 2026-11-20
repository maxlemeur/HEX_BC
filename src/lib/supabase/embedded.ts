/**
 * PostgREST returns an embedded to-one relation as an object or as a one-element
 * array, depending on how it infers the relationship. Reads it as one row or `null`.
 */
export function resolveEmbeddedOne<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}
