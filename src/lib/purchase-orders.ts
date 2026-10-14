import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

type Supabase = SupabaseClient<Database>;
type TenantRole = Database["public"]["Enums"]["tenant_role"];

const PURCHASE_ORDER_WRITE_ROLES = new Set<TenantRole>(["admin", "engineer"]);

export async function canWritePurchaseOrders(
  supabase: Supabase,
  userId: string,
  tenantId?: string
) {
  let resolvedTenantId = tenantId;
  if (!resolvedTenantId) {
    const { data: currentTenantId, error: tenantError } = await supabase.rpc(
      "current_tenant_id"
    );
    if (tenantError || !currentTenantId) return false;
    resolvedTenantId = currentTenantId;
  }

  const { data, error } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, role, is_default, created_at")
    .eq("user_id", userId)
    .eq("tenant_id", resolvedTenantId)
    .limit(1);

  if (error) return false;

  const membership = data?.[0];

  return membership?.role
    ? PURCHASE_ORDER_WRITE_ROLES.has(membership.role)
    : false;
}

export async function getAccessiblePurchaseOrderOrNull<
  T extends Record<string, unknown>,
>(
  supabase: Supabase,
  orderId: string,
  selectColumns: string
): Promise<T | null> {
  const { data, error } = await supabase
    .from("purchase_orders")
    .select(selectColumns)
    .eq("id", orderId)
    .single();

  if (error || !data) {
    return null;
  }

  return data as unknown as T;
}

/**
 * Embedded PostgREST rows can be capped even when the header is complete.
 * Count after the snapshot, then check its monotone revision. These reads must
 * stay sequential: reading the revision before the count would allow a delete
 * between them to disguise a previously truncated snapshot.
 */
export async function assertCompletePurchaseOrderSnapshot(
  supabase: Supabase,
  orderId: string,
  editRevision: number,
  itemCount: number,
): Promise<void> {
  const changedMessage = "Lecture modifiée. Rechargez la commande.";
  if (!Number.isSafeInteger(editRevision) || editRevision < 0) throw new Error(changedMessage);
  const countResult = await supabase.from("purchase_order_items")
    .select("id", { count: "exact", head: true }).eq("purchase_order_id", orderId);
  if (countResult.error || countResult.count === null) throw new Error(changedMessage);
  const revisionResult = await supabase.from("purchase_orders")
    .select("edit_revision").eq("id", orderId).single();
  if (revisionResult.error || revisionResult.data?.edit_revision !== editRevision) {
    throw new Error(changedMessage);
  }
  if (countResult.count !== itemCount) {
    throw new Error("Lecture incomplète. Consultez l’export complet depuis la liste des commandes.");
  }
}
