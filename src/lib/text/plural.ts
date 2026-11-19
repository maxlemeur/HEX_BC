/** A French count with its noun: the singular up to one (« 0 ligne », « 1 ligne »), the plural above (« 2 lignes »). */
export function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}
