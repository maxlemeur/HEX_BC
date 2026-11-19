/** « 1 ligne », « 3 lignes »: the count with its noun; the plural defaults to the noun plus « s ». */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}
