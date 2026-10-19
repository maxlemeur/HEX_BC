import type { SupabaseClient } from "@supabase/supabase-js";

import { ESTIMATE_VERSION_CONFLICT_MESSAGE } from "@/lib/estimates/constants";
import { conflict, internalError, mapSupabaseError, notFound } from "@/lib/estimates/errors";
import type { Database } from "@/types/database";

type Supabase = SupabaseClient<Database>;
type Item = Database["public"]["Tables"]["estimate_items"]["Row"];
type Version = Pick<Database["public"]["Tables"]["estimate_versions"]["Row"],
  "id" | "tenant_id" | "project_id" | "status" | "updated_at" | "content_revision">;

type ItemsScope = { supabase: Supabase; tenantId: string; versionId: string };

const PAGE_SIZE = 500;
/** Identifiers per `in` filter: about 3,7 Ko of query string. */
const IN_FILTER_CHUNK = 100;
/** Far above any section depth: a deeper walk means a cyclic or corrupt hierarchy. */
const MAX_SUBTREE_LEVELS = 64;

/** Call after version authorization; never return a partially read estimate. */
export async function readAllEstimateItems(input: ItemsScope): Promise<Item[]> {
  return readItemPages(input);
}

/**
 * Lot 3.1: the items `ids` names in the version (the selected sections of a copy) and all their descendants, level
 * by level, each level by pages; never a partial subtree. A copy no longer reads the whole source version: IO13 read
 * 4 000 items (6,7 Mo) to copy one section of 999 lines. Call after version authorization, then
 * assertEstimateVersionUnchanged: a write between two reads changes the version's content revision. Within a parent,
 * items keep the order of a full read (position, then id). An item reached twice (a selected section inside another
 * selected one) is kept once.
 */
export async function readEstimateItemSubtrees(input: ItemsScope & { ids: readonly string[] }): Promise<Item[]> {
  const items: Item[] = [];
  const seen = new Set<string>();
  let level = await readItemsWhereIn(input, "id", [...new Set(input.ids)]);
  for (let depth = 0; level.length > 0; depth += 1) {
    if (depth > MAX_SUBTREE_LEVELS) throw internalError("La hiérarchie des lignes est incohérente. Rechargez le chiffrage.");
    const parents: string[] = [];
    for (const item of level) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
      if (item.item_type === "section") parents.push(item.id);
    }
    if (parents.length === 0) break;
    level = await readItemsWhereIn(input, "parent_id", parents);
  }
  return items;
}

async function readItemsWhereIn(input: ItemsScope, column: "id" | "parent_id", values: readonly string[]) {
  const items: Item[] = [];
  for (let start = 0; start < values.length; start += IN_FILTER_CHUNK) {
    for (const item of await readItemPages(input, { column, values: values.slice(start, start + IN_FILTER_CHUNK) })) {
      items.push(item);
    }
  }
  return items;
}

/** Every item of the version, or those whose `column` is in `values`, by pages; never a partial set. */
async function readItemPages(input: ItemsScope, filter?: { column: "id" | "parent_id"; values: readonly string[] }) {
  const pageSize = PAGE_SIZE;
  const items: Item[] = [];
  const ids = new Set<string>();
  let expectedCount: number | null = null;
  for (let offset = 0; ; offset += pageSize) {
    let query = input.supabase
      .from("estimate_items")
      .select("*", { count: "exact" })
      .eq("tenant_id", input.tenantId)
      .eq("version_id", input.versionId);
    if (filter) query = query.in(filter.column, [...filter.values]);
    const { data, error, count } = await query
      .order("position", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw mapSupabaseError(error, "Impossible de charger les lignes.");
    if (count === null || !Number.isSafeInteger(count) || count < 0 ||
      (expectedCount !== null && count !== expectedCount)) {
      throw internalError("Impossible de vérifier la lecture complète des lignes.");
    }
    expectedCount = count;
    const batch = data ?? [];
    for (const item of batch) {
      if (ids.has(item.id)) {
        throw internalError("La lecture des lignes est incohérente. Rechargez le chiffrage.");
      }
      ids.add(item.id);
      items.push(item);
    }
    if (batch.length < pageSize) {
      if (items.length !== expectedCount) {
        throw internalError("La lecture des lignes est incomplète. Rechargez le chiffrage.");
      }
      return items;
    }
  }
}

/** Check after all enrichment, without rebasing the version returned to callers. */
export async function assertEstimateVersionUnchanged(input: {
  supabase: Supabase;
  version: Version;
}): Promise<void> {
  const { data, error } = await input.supabase
    .from("estimate_versions")
    .select("id, tenant_id, project_id, status, updated_at, content_revision")
    .eq("tenant_id", input.version.tenant_id)
    .eq("id", input.version.id)
    .abortSignal(new AbortController().signal)
    .single();
  if (error) throw mapSupabaseError(error, "Impossible de vérifier la version du chiffrage.");
  if (!data) throw notFound("Version de chiffrage introuvable.");
  const keys = ["id", "tenant_id", "project_id", "status", "updated_at", "content_revision"] as const;
  if (keys.some((key) => data[key] !== input.version[key])) {
    throw conflict(ESTIMATE_VERSION_CONFLICT_MESSAGE, undefined, "VERSION_CONFLICT");
  }
}
