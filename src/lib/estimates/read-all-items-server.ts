import type { SupabaseClient } from "@supabase/supabase-js";

import { ESTIMATE_VERSION_CONFLICT_MESSAGE } from "@/lib/estimates/constants";
import { conflict, internalError, mapSupabaseError, notFound } from "@/lib/estimates/errors";
import type { Database } from "@/types/database";

type Supabase = SupabaseClient<Database>;
type Item = Database["public"]["Tables"]["estimate_items"]["Row"];
type Version = Pick<Database["public"]["Tables"]["estimate_versions"]["Row"],
  "id" | "tenant_id" | "project_id" | "status" | "updated_at" | "content_revision">;

/** Call after version authorization; never return a partially read estimate. */
export async function readAllEstimateItems(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
}): Promise<Item[]> {
  const pageSize = 500;
  const items: Item[] = [];
  const ids = new Set<string>();
  let expectedCount: number | null = null;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error, count } = await input.supabase
      .from("estimate_items")
      .select("*", { count: "exact" })
      .eq("tenant_id", input.tenantId)
      .eq("version_id", input.versionId)
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
