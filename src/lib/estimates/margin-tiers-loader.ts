import type { SupabaseClient } from "@supabase/supabase-js";

import type { MarginMode } from "@/lib/estimate-calculations";
import { mapSupabaseError } from "@/lib/estimates/errors";
import type { MarginTier } from "@/lib/estimates/margin-tiers";
import type { Database } from "@/types/database";

type Supabase = SupabaseClient<Database>;

/**
 * Mode de marge a utiliser pour RENDRE une version (ecran, impression, portail,
 * PDF).
 *
 * Un devis qui n'est plus un brouillon a ete transmis, voire signe : il doit
 * afficher ce qui a ete transmis. Or en mode `tiered`, le moteur RE-RESOUT le
 * palier depuis le bareme COURANT du tenant a chaque rendu
 * (`estimate-calculations.ts`, `appliedMarginMultiplier`). Si le tenant modifie
 * son bareme, les sous-totaux de chapitre d'un devis deja envoye se mettent a
 * diverger de ses propres lignes et de son pied — ceux-ci etant lus des colonnes
 * stockees.
 *
 * On force donc `fixed` hors brouillon : la version utilise le
 * `margin_multiplier` qu'elle a PERSISTE (c'est-a-dire le multiplicateur
 * effectivement applique au moment du calcul), et plus le bareme du jour.
 *
 * Corollaire produit : pour repartir d'un devis signe avec un nouveau bareme, on
 * cree une VARIANTE (`duplicateEstimateVersion({ as_variant: true })`), on ne
 * modifie pas l'original.
 */
export function resolveRenderMarginMode(
  status: string | null | undefined,
  marginMode: MarginMode | null | undefined
): MarginMode {
  if (status !== "draft") return "fixed";
  return marginMode ?? "fixed";
}

/**
 * Charge le barème de marge (`margin_tiers`) du tenant pour le moteur de totaux.
 *
 * Extrait de `server.ts` (EST-E26, T6, étape 6) : depuis que `marginTiers` est
 * OBLIGATOIRE sur `computeEstimateTotals`, les pages serveur et le générateur
 * PDF doivent injecter le barème du tenant. Ce module léger (aucune dépendance
 * à `next/headers` ni à `server.ts`) leur évite d'importer tout `server.ts`,
 * qui importe déjà `pdf-generator` — un import direct créerait un cycle.
 *
 * Le client Supabase est injecté : utilisable avec le client anon (RLS) comme
 * avec le client service-role du portail.
 */
export async function loadMarginTiersForTotals(input: {
  supabase: Supabase;
  tenantId: string;
}): Promise<MarginTier[]> {
  const { data, error } = await input.supabase
    .from("margin_tiers")
    .select("threshold_cents, multiplier")
    .eq("tenant_id", input.tenantId)
    .order("threshold_cents", { ascending: true })
    .order("position", { ascending: true });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les tranches de marge.");
  }

  return (data ?? []).map((tier) => ({
    threshold_cents: tier.threshold_cents,
    multiplier: tier.multiplier,
  }));
}
