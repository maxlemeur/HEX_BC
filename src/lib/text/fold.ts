/** Lowercase, accent-free form of a label, for matching copy that may or may not be accented. */
export function foldText(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
