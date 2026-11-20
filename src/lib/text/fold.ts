/** The text without its accents (combining marks removed), case kept. */
export function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Lowercase, accent-free form of a label, for matching copy that may or may not be accented. */
export function foldText(value: string): string {
  return stripAccents(value).toLowerCase();
}

/** The folded words of a label: lowercase, accent-free, each run of other characters than a-z and 0-9 one space. */
export function foldWords(value: string): string {
  return foldText(value).replace(/[^a-z0-9]+/g, " ").trim();
}
