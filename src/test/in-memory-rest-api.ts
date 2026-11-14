import { createClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
export type InMemoryRestRequest = { table: string; url: URL };
/** Answers a table whose read the generic filters below cannot express (an embedded resource, for example). */
export type InMemoryRestHandler = (url: URL, rows: Row[]) => Row[];

const RESERVED = new Set(["select", "order", "limit", "offset", "or"]);

function matches(row: Row, column: string, filter: string): boolean {
  const value = row[column];
  if (filter.startsWith("eq.")) return String(value) === filter.slice(3);
  if (filter.startsWith("in.(")) {
    return filter.slice(4, -1).split(",").map((item) => item.replace(/^"|"$/g, "")).includes(String(value));
  }
  if (filter === "is.null") return value === null || value === undefined;
  throw new Error(`Unsupported filter in the in-memory REST fixture: ${column}=${filter}`);
}

/**
 * A real supabase-js client over in-memory tables: `eq`, `in`, `is.null`, a flat `or`, `order`,
 * `offset`/`limit` and the exact count header. It records every HTTP request, so a test can count
 * the round trips of a reader and compare two readers on the same rows.
 */
export function createInMemoryRestApi(
  tables: Record<string, Row[]>,
  handlers: Record<string, InMemoryRestHandler> = {}
) {
  const requests: InMemoryRestRequest[] = [];
  const client = createClient("https://example.test", "test-anon", { global: { fetch: async (input) => {
    const url = new URL(String(input));
    const table = url.pathname.replace(/^\/rest\/v1\//, "");
    requests.push({ table, url });
    const source = tables[table] ?? [];
    let rows: Row[];
    if (handlers[table]) {
      rows = handlers[table](url, source);
    } else {
      rows = source.filter((row) => {
        for (const [column, filter] of url.searchParams) {
          if (RESERVED.has(column)) continue;
          if (!matches(row, column, filter)) return false;
        }
        const or = url.searchParams.get("or");
        if (!or) return true;
        return or.slice(1, -1).split(",").some((clause) => {
          const [column, ...rest] = clause.split(".");
          return matches(row, column, rest.join("."));
        });
      });
      const order = (url.searchParams.get("order") ?? "").split(",").filter(Boolean).map((part) => part.split("."));
      rows = [...rows].sort((left, right) => {
        for (const [column, direction] of order) {
          const a = left[column] as string | number;
          const b = right[column] as string | number;
          if (a === b) continue;
          return (a < b ? -1 : 1) * (direction === "desc" ? -1 : 1);
        }
        return 0;
      });
    }
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 1000);
    const page = rows.slice(offset, offset + limit);
    return new Response(JSON.stringify(page), { status: 200, headers: {
      "content-type": "application/json",
      "content-range": `${offset}-${offset + page.length - 1}/${rows.length}`,
    } });
  } } });
  return { client, requests };
}
