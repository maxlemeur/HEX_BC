import { compareQuantityPairs, surfaceBasis } from "@/lib/takeoff/quantity-policy";
import { readRuleInputs } from "@/lib/takeoff/rules/contracts";
import type { TakeoffDpgfComparisonRow } from "@/lib/takeoff/types";

/** The DPGF total is one real pair. Known printed/measured sub-pairs may reveal errors its total would cancel. */
export function dpgfQuantityPolicy(row: Pick<TakeoffDpgfComparisonRow, "dpgf_quantity" | "takeoff_quantity" | "linked_takeoff_items">) {
  if (row.takeoff_quantity === null) return null;
  const pairs = row.linked_takeoff_items.flatMap(item => {
    const inputs = readRuleInputs(item.metadata);
    return inputs?.source === "vector" && inputs.kind === "surface" && surfaceBasis(inputs.room ?? "") === "net_floor"
      && typeof inputs.printed_m2 === "number" && inputs.printed_m2 > 0
      ? [{ reference: inputs.printed_m2, measured: inputs.model_quantity }] : [];
  });
  const printed = compareQuantityPairs(pairs);
  // Keep the other measured contributions, without assigning them invented printed references.
  const protectiveMeasured = row.takeoff_quantity + (printed ? printed.priced - printed.measured : 0);
  if (row.dpgf_quantity === null) return { reference: null, measured: row.takeoff_quantity, priced: protectiveMeasured,
    absoluteGap: null, percentGap: null, requiresReview: false };
  const total = compareQuantityPairs([{ reference: row.dpgf_quantity, measured: row.takeoff_quantity }])!;
  const absoluteGap = Math.max(total.absoluteGap, printed?.absoluteGap ?? 0);
  return { ...total, priced: Math.max(total.priced, protectiveMeasured), absoluteGap,
    percentGap: total.reference > 0 ? absoluteGap / total.reference * 100 : null,
    requiresReview: absoluteGap > total.reference / 100 + 1e-9 };
}
