/**
 * Lot 2, sous-lot 2.4 - TVA par taux sur la base nette (conception §4, étape 10 ; D8).
 *
 * base_r = Σ des nets des lignes chiffrées au taux r ; T_r = ⌈base_r × r / 10 000⌋ (0 en
 * autoliquidation) ; TVA de ligne = répartition exacte de T_r selon les nets du groupe. Le
 * récapitulatif a une ligne par taux distinct des lignes chiffrées, par taux croissant.
 */
import { allocateExact } from "@/lib/estimates/engine-v3/allocate";
import { divideHalfUp, ZERO } from "@/lib/estimates/engine-v3/decimal";

const BASIS_POINTS = BigInt(10000);

export type V3TaxLine = { key: string; priced: boolean; rateBp: bigint; net: bigint };
export type V3TaxGroup = { rateBp: bigint; base: bigint; tax: bigint };

export function computeTaxByRate(
  lines: readonly V3TaxLine[],
  reverseCharge: boolean
): { groups: V3TaxGroup[]; lineTax: bigint[] } {
  const lineTax = lines.map(() => ZERO);
  const indexesByRate = new Map<bigint, number[]>();
  lines.forEach((line, index) => {
    if (!line.priced) return;
    const indexes = indexesByRate.get(line.rateBp) ?? [];
    indexes.push(index);
    indexesByRate.set(line.rateBp, indexes);
  });
  const rates = [...indexesByRate.keys()].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const groups = rates.map((rateBp) => {
    const indexes = indexesByRate.get(rateBp) ?? [];
    const base = indexes.reduce((sum, index) => sum + lines[index].net, ZERO);
    const tax = reverseCharge ? ZERO : divideHalfUp(base * rateBp, BASIS_POINTS);
    const parts = allocateExact(
      tax,
      indexes.map((index) => ({ key: lines[index].key, weight: lines[index].net }))
    );
    indexes.forEach((lineIndex, position) => {
      lineTax[lineIndex] = parts[position];
    });
    return { rateBp, base, tax };
  });
  return { groups, lineTax };
}
