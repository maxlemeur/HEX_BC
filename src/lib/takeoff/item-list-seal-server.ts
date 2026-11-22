import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { mapSupabaseError } from "@/lib/http/api-response";
import type { Database } from "@/types/database";
import { resolveSealableItemList } from "./item-list-server";
import { TAKEOFF_FREE_EXTRACTION_ORDER, type TakeoffLaunchOrder } from "./launch-request";
import type { Poste } from "./poste-list";

/**
 * The measuring order a launch request seals at admission. Until the owner activates the second order (once the
 * worker reads a sealed list, lot 4 PR 3), the free extraction, as before. Once active, the affaire's stored list (its
 * first revision recorded on the payer's behalf if it has none): a DPGF still to prepare or to choose suspends the
 * admission, and the Mac of the mandate tries again. The database checks the sealed revision again at the seal.
 *
 * The list is answered plan by plan: a request of one grouped unit (`perPlan` false, one analysis per plan not active)
 * seals the free extraction whatever the second order's activation says, so that no grouped manifest carries a list.
 * The caller passes the decision it splits the request's units on. A list without any item (a DPGF of structural rows
 * only) asks nothing: the free extraction too. `items`: the sealed revision's items, in order (none for the free
 * extraction), for the admission's bounds.
 */
export async function sealedMeasuringOrder(service: SupabaseClient<Database>, input: {
  tenantId: string; projectId: string; payerId: string; perPlan: boolean;
}): Promise<{ order: TakeoffLaunchOrder; items: readonly Poste[] } | { blocked: "ITEM_LIST_TO_PREPARE" }> {
  const free = { order: TAKEOFF_FREE_EXTRACTION_ORDER, items: [] };
  if (!input.perPlan) return free;
  const { data: active, error } = await service.rpc("takeoff_item_list_order_is_active");
  if (error) throw mapSupabaseError(error, "Impossible de lire l’activation de la liste des postes.");
  if (active !== true) return free;
  const sealed = await resolveSealableItemList(service, input);
  if (!sealed.order) return { blocked: "ITEM_LIST_TO_PREPARE" };
  return sealed.order.list.item_count === 0 ? free : { order: sealed.order, items: sealed.items };
}
