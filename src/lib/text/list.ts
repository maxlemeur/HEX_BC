/** Items named in a French sentence: « a », « a et b », « a, b et c ». */
export function listOf(items: readonly string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} et ${items[items.length - 1]}`;
}
