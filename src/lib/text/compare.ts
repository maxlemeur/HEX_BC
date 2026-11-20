/** Orders strings by UTF-16 code units, like `Array.prototype.sort` without a comparator; 0 when equal. */
export function byText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}
