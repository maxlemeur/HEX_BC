export function toUnitToken(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * The units that count pieces, as normalised tokens: the rule of a count in the preparation's checks, and the only items
 * a set of marks gives a quantity to (the database's private.takeoff_count_unit_counts holds the same list).
 */
export const TAKEOFF_COUNT_UNIT_TOKENS = ["u", "un", "unite", "unites", "unit", "units", "pce", "piece", "pieces", "pcs", "pc",
  "nb", "ens", "ensemble", "lot"] as const;

export function isTakeoffCountUnit(value: string | null | undefined) {
  return typeof value === "string" && (TAKEOFF_COUNT_UNIT_TOKENS as readonly string[]).includes(toUnitToken(value));
}
