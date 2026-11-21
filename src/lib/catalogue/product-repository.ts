import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

type CatalogueClient = SupabaseClient<Database>;
type ProductInsert = Database["public"]["Tables"]["products"]["Insert"];

/** One statement per supplied lot, using the caller's catalogue policies. */
export function insertCatalogueProducts(
  supabase: CatalogueClient,
  products: ProductInsert | ProductInsert[]
) {
  return supabase.from("products").insert(products);
}
