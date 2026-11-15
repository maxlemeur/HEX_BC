/**
 * Comparable form of a free-text label: accent-free, lowercase, punctuation
 * turned into single spaces. Used before measuring how close two labels are.
 */
export function normalizeCompareText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Edit distance (insertions, deletions, substitutions) between two strings. */
export function levenshteinDistance(left: string, right: string) {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  const distances = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let i = 1; i <= left.length; i += 1) {
    let previous = i - 1;
    distances[0] = i;

    for (let j = 1; j <= right.length; j += 1) {
      const temp = distances[j];
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      distances[j] = Math.min(
        distances[j] + 1,
        distances[j - 1] + 1,
        previous + substitutionCost
      );
      previous = temp;
    }
  }

  return distances[right.length];
}
