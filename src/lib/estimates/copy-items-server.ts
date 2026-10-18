import type { SupabaseClient } from "@supabase/supabase-js";

import { conflict, internalError, mapSupabaseError } from "@/lib/estimates/errors";
import type { Database, Json } from "@/types/database";

type Supabase = SupabaseClient<Database>;
type ItemInsert = Database["public"]["Tables"]["estimate_items"]["Insert"];
type CopiedColumn =
  | "id" | "parent_id" | "item_type" | "position" | "title" | "aid" | "description" | "quantity"
  | "unit_price_ht_cents" | "tax_rate_bp" | "k_fo" | "h_mo" | "h_mo_majoration" | "k_mo" | "h_mo_atelier"
  | "k_mo_atelier" | "labor_role_atelier_id" | "h_mo_chantier" | "k_mo_chantier" | "labor_role_chantier_id"
  | "pu_ht_cents" | "labor_role_id" | "category_id" | "supply_type_id" | "selected_supplier_price_id"
  | "source_provider" | "source_job_id" | "source_file_name" | "source_page" | "source_metadata"
  | "line_total_ht_cents" | "line_tax_cents" | "line_total_ttc_cents";

/**
 * Every column a copy writes, all present: the stored row is the one the copy states, never a column default.
 * `tenant_id` and `version_id`, when present, must be those of the target version.
 */
export type CopiedEstimateItem = Required<Pick<ItemInsert, CopiedColumn>> & Pick<ItemInsert, "tenant_id" | "version_id">;

/**
 * Inserts the items of a copy into a v1/v2 draft in one statement (public.copy_estimate_items_atomic,
 * docs/testing/copy-large-v2.md): the insert policy and the draft lock lease of this page are checked once, the
 * per-item effects (depth, content revision, audit, source coverage) are replayed set-based. Items are in insertion
 * order, parents before their children. Call after the route's own draft and lock checks.
 */
export async function insertCopiedEstimateItems(input: {
  supabase: Supabase;
  versionId: string;
  draftLockSessionId: string | null | undefined;
  items: CopiedEstimateItem[];
  failureMessage: string;
}) {
  if (!input.draftLockSessionId) {
    throw conflict("Un verrou actif de cette page est requis.", undefined, "LOCK_REQUIRED");
  }
  const { data, error } = await input.supabase.rpc("copy_estimate_items_atomic", {
    p_version_id: input.versionId,
    p_draft_lock_session_id: input.draftLockSessionId,
    p_items: input.items as unknown as Json,
  });
  if (error) {
    if (error.message === "ESTIMATE_COPY_LOCK_REQUIRED") {
      throw conflict("Un verrou actif de cette page est requis.", undefined, "LOCK_REQUIRED");
    }
    throw mapSupabaseError(error, input.failureMessage);
  }
  const saved = data as { item_count?: unknown; version?: { id?: unknown } } | null;
  // The route may name the version in upper case; the database answers in lower case.
  if (saved?.item_count !== input.items.length ||
    String(saved.version?.id).toLowerCase() !== input.versionId.toLowerCase()) {
    throw internalError(input.failureMessage);
  }
}
