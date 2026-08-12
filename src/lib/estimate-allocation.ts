/**
 * Repartit un montant en centimes selon la methode du plus grand reste.
 * L'interface garantit des parts positives, deterministes et une somme exacte.
 */
export function allocateProRata(amount: number, weights: number[]): number[] {
  const count = weights.length;
  if (count === 0) return [];

  const safeAmount = Math.max(
    Math.round(Number.isFinite(amount) ? amount : 0),
    0
  );
  const safeWeights = weights.map((weight) =>
    Math.max(Number.isFinite(weight) ? weight : 0, 0)
  );
  if (safeAmount === 0) return new Array<number>(count).fill(0);

  const totalWeight = safeWeights.reduce((sum, weight) => sum + weight, 0);
  // Le quotient reste borne par safeAmount, contrairement au produit direct
  // safeAmount * weight sur de tres gros devis.
  const exact = safeWeights.map((weight) =>
    totalWeight > 0
      ? safeAmount * (weight / totalWeight)
      : safeAmount / count
  );
  const parts = exact.map((value) => Math.floor(value));
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) =>
      right.fraction !== left.fraction
        ? right.fraction - left.fraction
        : left.index - right.index
    );

  let remainder = safeAmount - parts.reduce((sum, part) => sum + part, 0);
  for (let index = 0; index < order.length && remainder > 0; index += 1) {
    parts[order[index].index] += 1;
    remainder -= 1;
  }

  const leftover = safeAmount - parts.reduce((sum, part) => sum + part, 0);
  if (leftover !== 0) {
    let target = 0;
    for (let index = 1; index < count; index += 1) {
      if (safeWeights[index] > safeWeights[target]) target = index;
    }
    parts[target] = Math.max(parts[target] + leftover, 0);
  }

  return parts;
}
