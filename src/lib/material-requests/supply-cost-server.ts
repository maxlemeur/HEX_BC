import { forbidden, internalError, mapSupabaseError, notFound } from "@/lib/estimates/errors";

import { affaireSupplyCostSchema, type AffaireSupplyCost } from "./supply-cost-contracts";
import { requireProjectAccess } from "./server-shared";

/**
 * The supply cost of an affaire (TI-691, delivery 4). public.affaire_supply_cost is SECURITY DEFINER (an order is
 * otherwise visible to its author and the admins only) and checks the rights itself; they are checked here first so
 * that a refusal has a status and a sentence: the readers of the affaire (its owner, an admin, a director).
 */
export async function getAffaireSupplyCost(projectId: string): Promise<AffaireSupplyCost> {
  const access = await requireProjectAccess(projectId, "read");
  const { data, error } = await access.context.supabase.rpc("affaire_supply_cost", { p_project_id: access.project.id });
  if (error) {
    if (error.message === "AFFAIRE_SUPPLY_COST_NOT_FOUND") throw notFound("Affaire introuvable.");
    if (error.message === "AFFAIRE_SUPPLY_COST_ACCESS_DENIED") throw forbidden("Accès refusé à cette affaire.");
    throw mapSupabaseError(error, "Impossible de calculer le coût des fournitures de l'affaire.");
  }
  const parsed = affaireSupplyCostSchema.safeParse(data);
  if (!parsed.success) throw internalError("Le coût des fournitures de l'affaire est incomplet.");
  return parsed.data;
}
