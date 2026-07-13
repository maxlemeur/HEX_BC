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
