import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

type Supabase = SupabaseClient<Database>;

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
