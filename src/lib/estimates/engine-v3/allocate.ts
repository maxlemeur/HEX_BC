/**
 * Lot 2, sous-lot 2.4 - répartition exacte au plus grand reste (conception D13).
 *
 * part_i = ⌊A·w_i / W⌋ ; les unités restantes vont aux plus grands restes A·w_i mod W, ex aequo
 * départagés par clé croissante (ordre lexical : uuid en minuscules = ordre `uuid` PostgreSQL ;
 * composantes de ligne `fo` < `mo`, `atelier` < `chantier`). Si W = 0 : parts égales, le reste
 * par clé croissante. Le résultat, rendu dans l'ordre d'entrée, ne dépend pas de cet ordre.
 * Nouvelle fonction : `allocateProRata` (`estimate-allocation.ts`) reste celle de la v2.
 */
import { type Decimal, ONE, unitsAtScale, ZERO } from "@/lib/estimates/engine-v3/decimal";

export type AllocationEntry = { readonly key: string; readonly weight: bigint };

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function allocateExact(amount: bigint, entries: readonly AllocationEntry[]): bigint[] {
  if (amount < ZERO) throw new Error("ESTIMATE_V3_ALLOCATION_NEGATIVE_AMOUNT");
  const keys = new Set<string>();
  let total = ZERO;
  for (const entry of entries) {
    if (entry.weight < ZERO) throw new Error("ESTIMATE_V3_ALLOCATION_NEGATIVE_WEIGHT");
    if (keys.has(entry.key)) throw new Error("ESTIMATE_V3_ALLOCATION_DUPLICATE_KEY");
    keys.add(entry.key);
    total += entry.weight;
  }
  if (amount === ZERO) return entries.map(() => ZERO);
  if (entries.length === 0) throw new Error("ESTIMATE_V3_ALLOCATION_WITHOUT_ENTRY");

  const indexes = entries.map((_entry, index) => index);
  if (total === ZERO) {
    const count = BigInt(entries.length);
    const base = amount / count;
    const extra = Number(amount % count);
    const parts = entries.map(() => base);
    indexes
      .sort((left, right) => compareKeys(entries[left].key, entries[right].key))
      .slice(0, extra)
      .forEach((index) => {
        parts[index] += ONE;
      });
    return parts;
  }

  const parts = entries.map((entry) => (amount * entry.weight) / total);
  const remainders = entries.map((entry) => (amount * entry.weight) % total);
  const allocated = parts.reduce((sum, part) => sum + part, ZERO);
  const leftover = Number(amount - allocated);
  indexes
    .sort((left, right) => {
      if (remainders[left] !== remainders[right]) return remainders[left] > remainders[right] ? -1 : 1;
      return compareKeys(entries[left].key, entries[right].key);
    })
    .slice(0, leftover)
    .forEach((index) => {
      parts[index] += ONE;
    });
  return parts;
}

/** Même répartition, poids décimaux ramenés à une échelle commune (rapports inchangés). */
export function allocateExactByDecimal(
  amount: bigint,
  entries: readonly { readonly key: string; readonly weight: Decimal }[]
): bigint[] {
  const scale = entries.reduce((max, entry) => Math.max(max, entry.weight.scale), 0);
  return allocateExact(
    amount,
    entries.map((entry) => ({ key: entry.key, weight: unitsAtScale(entry.weight, scale) }))
  );
}
