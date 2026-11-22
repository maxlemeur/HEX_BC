import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { mapSupabaseError } from "@/lib/http/api-response";
import type { Database } from "@/types/database";
import { resolveSealableItemList } from "./item-list-server";
import { TAKEOFF_FREE_EXTRACTION_ORDER, type TakeoffLaunchOrder } from "./launch-request";

/**
 * The measuring order a launch request seals at admission. Until the owner activates the second order (once the
 * worker reads a sealed list, lot 4 PR 3), the free extraction, as before. Once active, the affaire's stored list (its
 * first revision recorded on the payer's behalf if it has none): a DPGF still to prepare or to choose suspends the
 * admission, and the Mac of the mandate tries again. The database checks the sealed revision again at the seal.
 */
export async function sealedMeasuringOrder(service: SupabaseClient<Database>, input: {
  tenantId: string; projectId: string; payerId: string;
}): Promise<{ order: TakeoffLaunchOrder } | { blocked: "ITEM_LIST_TO_PREPARE" }> {
  const { data: active, error } = await service.rpc("takeoff_item_list_order_is_active");
  if (error) throw mapSupabaseError(error, "Impossible de lire l’activation de la liste des postes.");
  if (active !== true) return { order: TAKEOFF_FREE_EXTRACTION_ORDER };
  const sealed = await resolveSealableItemList(service, input);
  return sealed.order ? { order: sealed.order } : { blocked: "ITEM_LIST_TO_PREPARE" };
}
