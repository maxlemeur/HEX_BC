/** The text without its accents (combining marks removed), case kept. */
export function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Lowercase, accent-free form of a label, for matching copy that may or may not be accented. */
export function foldText(value: string): string {
  return stripAccents(value).toLowerCase();
}
