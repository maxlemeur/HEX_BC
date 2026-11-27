import "server-only";

const MAX_CONCURRENT_PARSES = 2;
const POOL_KEY = Symbol.for("mergeone.spreadsheet-workbook-parse-pool");

// Next may bundle the two routes independently in the same Node process.
const runtime = globalThis as typeof globalThis & { [POOL_KEY]?: { active: number } };

export function acquireWorkbookParseSlot(): (() => void) | null {
  const pool = runtime[POOL_KEY] ??= { active: 0 };
  if (pool.active >= MAX_CONCURRENT_PARSES) return null;
  pool.active += 1;
  return () => { pool.active -= 1; };
}
