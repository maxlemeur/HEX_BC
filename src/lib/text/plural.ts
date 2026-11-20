/** A French count with its noun: the singular up to one (« 0 ligne », « 1 ligne »), the plural above (« 2 lignes »), which defaults to the noun plus « s ». */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}
