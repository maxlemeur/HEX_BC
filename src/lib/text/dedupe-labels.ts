/**
 * Trims each label, drops blank ones and keeps the first spelling of labels
 * that only differ by case (French collation), in their original order.
 */
export function dedupeLabels(values: string[]) {
  const seen = new Set<string>();
  const nextValues: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }

    const key = trimmed.toLocaleLowerCase("fr-FR");
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    nextValues.push(trimmed);
  }

  return nextValues;
}
