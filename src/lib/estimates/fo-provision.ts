/**
 * TI-534, lot 1 - provision FO automatique d'une ligne du moteur 3 (pertes, chutes, petites fournitures) :
 * FO_unitaire = P × provision FO × K FO.
 *
 * Miroir du déclencheur `private.derive_estimate_item_fo_provision` (migration 20261024002500) : une ligne v3 créée
 * sans provision reçoit celle de son type FO (`supply_types.default_fo_provision` : 1,030 pour un tube ou un
 * calorifuge, 1,010 sinon), 1,010 sans type ; un changement de type FO la redérive. Une ligne v1/v2 et une section
 * gardent 1,000, comme toute ligne antérieure. Les projections calculées avant l'écriture (lot, création atomique,
 * création de devis) l'appliquent pour que le contrôle D12 retrouve les montants du SQL.
 */
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

/** Provision d'une ligne v3 sans type FO (ou d'un type inconnu du locataire). */
export const DEFAULT_FO_PROVISION = 1.01;

/** Provisions par identifiant de type FO (uuid en minuscules, comme PostgreSQL le rend). */
export type FoProvisionBySupplyTypeId = ReadonlyMap<string, number>;

export function deriveFoProvision(
  supplyTypeId: string | null | undefined,
  provisions: FoProvisionBySupplyTypeId
): number {
  return (supplyTypeId ? provisions.get(supplyTypeId.toLowerCase()) : undefined) ?? DEFAULT_FO_PROVISION;
}

/** Un changement de type FO, au sens du déclencheur (uuid comparés sans la casse). */
export function supplyTypeChanged(previous: string | null | undefined, next: string | null | undefined): boolean {
  return (previous ?? null)?.toLowerCase() !== (next ?? null)?.toLowerCase();
}

/**
 * Miroir local du déclencheur pour une ligne v3 de l'éditeur : un correctif qui change le type FO redérive la
 * provision depuis le type, tout autre correctif garde la provision stockée (une ligne antérieure garde 1,000).
 */
export function withRederivedFoProvision<T extends { supply_type_id: string | null; fo_provision?: number | null }>(
  previous: Pick<T, "supply_type_id"> | undefined,
  next: T,
  provisions: FoProvisionBySupplyTypeId
): T {
  if (!previous || !supplyTypeChanged(previous.supply_type_id, next.supply_type_id)) return next;
  return { ...next, fo_provision: deriveFoProvision(next.supply_type_id, provisions) };
}

/**
 * Ligne serveur recouverte de ses saisies en attente (brouillon local, rechargement) : une ligne v3 dont elles changent
 * le type FO reprend la provision de ce type, comme l'écriture la redérivera ; toute autre ligne reste telle quelle.
 */
export function withBufferedFoProvision<
  T extends { item_type: string; supply_type_id: string | null; fo_provision?: number | null },
>(source: T, merged: T, provisions: FoProvisionBySupplyTypeId, isV3: boolean): T {
  return isV3 && merged.item_type === "line" ? withRederivedFoProvision(source, merged, provisions) : merged;
}

/** Provisions par type FO (identifiant en minuscules) des types chargés. */
export function foProvisionsBySupplyType(
  supplyTypes: Iterable<{ id: string; default_fo_provision: number | string }>
): Map<string, number> {
  const provisions = new Map<string, number>();
  for (const supplyType of supplyTypes) provisions.set(supplyType.id.toLowerCase(), Number(supplyType.default_fo_provision));
  return provisions;
}

/** Provisions des types FO cités, lues dans le locataire ; un type absent prend la valeur par défaut. */
export async function loadSupplyTypeFoProvisions(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  supplyTypeIds: Iterable<string | null | undefined>
): Promise<{ provisions: Map<string, number>; error: PostgrestError | null }> {
  const ids = [...new Set([...supplyTypeIds].filter((id): id is string => typeof id === "string" && id.length > 0))];
  const provisions = new Map<string, number>();
  if (ids.length === 0) return { provisions, error: null };
  const { data, error } = await supabase.from("supply_types").select("id, default_fo_provision")
    .eq("tenant_id", tenantId).in("id", ids);
  if (error) return { provisions, error };
  for (const row of data ?? []) provisions.set(row.id.toLowerCase(), Number(row.default_fo_provision));
  return { provisions, error: null };
}
