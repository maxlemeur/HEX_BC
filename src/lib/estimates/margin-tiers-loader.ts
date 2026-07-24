import type { SupabaseClient } from "@supabase/supabase-js";

import { mapSupabaseError } from "@/lib/estimates/errors";
import type { MarginTier } from "@/lib/estimates/margin-tiers";
import type { Database } from "@/types/database";

type Supabase = SupabaseClient<Database>;

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
