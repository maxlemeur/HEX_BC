import { compareQuantityPairs, surfaceBasis } from "@/lib/takeoff/quantity-policy";
import { lengthFactor, roundedMeasure } from "@/lib/takeoff/page-replacement";
import { readRuleInputs } from "@/lib/takeoff/rules/contracts";
import type { TakeoffDpgfComparisonRow } from "@/lib/takeoff/types";

/**
 * The DPGF total is one real pair. Known printed/measured sub-pairs may reveal errors its total would cancel.
 * TI-682 D4: `earlier` is what the target keeps of the other takeoffs (its measure, the part its printed surfaces protect
 * and their gap): the pair is then judged on the total the target will hold. Without it, this takeoff's own pair (what
 * the application authorizes for its lines).
 */
export function dpgfQuantityPolicy(row: Pick<TakeoffDpgfComparisonRow, "dpgf_quantity" | "takeoff_quantity" | "linked_takeoff_items">,
  earlier?: { measured: number; protective: number; printed_gap: number }) {
  if (row.takeoff_quantity === null) return null;
  const measured = row.takeoff_quantity + (earlier?.measured ?? 0);
  const pairs = row.linked_takeoff_items.flatMap(item => {
    const inputs = readRuleInputs(item.metadata);
    return inputs?.source === "vector" && inputs.kind === "surface" && surfaceBasis(inputs.room ?? "") === "net_floor"
      && typeof inputs.printed_m2 === "number" && inputs.printed_m2 > 0
      ? [{ reference: inputs.printed_m2, measured: inputs.model_quantity }] : [];
  });
  const printed = compareQuantityPairs(pairs);
  // Keep the other measured contributions, without assigning them invented printed references.
  const protectiveMeasured = measured + (printed ? printed.priced - printed.measured : 0) + (earlier?.protective ?? 0);
  if (row.dpgf_quantity === null) return { reference: null, measured, priced: protectiveMeasured,
    absoluteGap: null, percentGap: null, requiresReview: false };
  const total = compareQuantityPairs([{ reference: row.dpgf_quantity, measured }])!;
  const absoluteGap = Math.max(total.absoluteGap, (printed?.absoluteGap ?? 0) + (earlier?.printed_gap ?? 0));
  return { ...total, priced: Math.max(total.priced, protectiveMeasured), absoluteGap,
    percentGap: total.reference > 0 ? absoluteGap / total.reference * 100 : null,
    requiresReview: absoluteGap > total.reference / 100 + 1e-9 };
}

type ReviewedRow = Pick<TakeoffDpgfComparisonRow, "dpgf_quantity" | "takeoff_quantity" | "linked_takeoff_items" | "composition">
  & { dpgf: Pick<TakeoffDpgfComparisonRow["dpgf"], "unit" | "description"> };

/**
 * TI-696: a reconciliation row's pair on the total its DPGF line will hold, the other takeoffs it keeps and this one, as
 * the proposal judges it (computeTakeoffDpgfRows).
 */
export function dpgfRowQuantityPolicy(row: ReviewedRow) {
  return dpgfQuantityPolicy(row, row.composition ? { measured: row.composition.earlier_quantity,
    protective: row.composition.earlier_protective, printed_gap: row.composition.earlier_printed_gap } : undefined);
}

/**
 * TI-696: the quantity the application writes on a reconciliation row's DPGF line: the protective maximum on its total, a
 * length rounded up once on it (finalize_takeoff_lengths, private.takeoff_compose_dpgf_targets). Null while this
 * takeoff's measure cannot be compared. Every figure the review states as retained reads it.
 */
export function dpgfRowRetainedQuantity(row: ReviewedRow) {
  const policy = dpgfRowQuantityPolicy(row);
  return policy ? roundedMeasure(policy.priced, lengthFactor({ unit_code: row.dpgf.unit, description: row.dpgf.description })) : null;
}
