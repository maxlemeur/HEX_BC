/**
 * A DPGF line of an estimate version: a line (`item_type` "line") its DPGF import brought (`source_provider` "dpgf").
 * A version holding one is reconciled, and the application of a takeoff merges into it: the server's own test is
 * `hasTakeoffDpgfTargetLines` (dpgf-comparison-repository.ts), the same two columns. A section a v3 linked import
 * creates carries `source_provider` "dpgf" too (planV3LinkedDpgfImport) and is not a DPGF line.
 */
export function isDpgfTargetLine(item: { item_type: string | null; source_provider: string | null }): boolean {
  return item.item_type === "line" && item.source_provider === "dpgf";
}
